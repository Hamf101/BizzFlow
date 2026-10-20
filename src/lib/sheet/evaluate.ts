import { parseCellRef } from "@/lib/sheet/a1"
import { FUNCTIONS, type FunctionContext } from "@/lib/sheet/functions"
import { parseFormula, type FormulaNode } from "@/lib/sheet/parse"
import {
  Area,
  MAX_TEXT,
  add,
  compareValues,
  dateSerial,
  divide,
  isError,
  multiply,
  power,
  round15,
  scalar,
  sheetError,
  subtract,
  toNumber,
  toText,
  type CellValue,
  type Result,
  type SheetErrorCode,
} from "@/lib/sheet/values"
import type { SheetContent } from "@/types/sheet"

// Works a sheet out. The server's answer is the one that counts; the browser
// runs the same code to show it while someone types.
//
// ponytail: full recompute per edit; add a dependency graph only if large sheets lag.

export type EvaluateOptions = {
  /** The moment TODAY() and NOW() read. */
  now: Date
  /** Whose calendar TODAY() follows; UTC unless given. */
  timeZone?: string
}

export type SheetEvaluation = {
  /** Every cell's value, keyed "tabId!A1", numbers kept to Excel's 15 significant digits. */
  values: Map<string, CellValue>
  /** The cells whose value is an error, and which. */
  errors: Map<string, SheetErrorCode>
}

// Cell reads one evaluation may make (about a second's work). 2000 rows of
// VLOOKUP plus 2000 running SUMs over 2000 rows is ~4M; a sheet built to hog
// the server is refused instead of worked out.
const MAX_WORK = 30_000_000
// A cell's place within its tab, and within the book.
const COLUMN_BITS = 6
const TAB_SHIFT = 2 ** 17
const place = (row: number, col: number) => (row << COLUMN_BITS) | col

type TabState = {
  index: number
  id: string
  literals: Map<number, CellValue>
  formulas: Map<number, string>
  /** Formula cells, for finding which ones a range covers. */
  formulaPlaces: number[]
  computed: Map<number, CellValue>
}

type Frame = { tab: TabState; at: number; node: FormulaNode | null; deps: number[]; next: number }

class Workbook {
  readonly tabs: TabState[]
  private readonly byName = new Map<string, TabState>()
  private readonly rangeDeps = new Map<string, number[]>()
  private readonly circular = new Set<number>()
  private work = 0

  constructor(
    content: SheetContent,
    private readonly context: FunctionContext
  ) {
    this.tabs = content.tabs.map((tab, index) => {
      const state: TabState = { index, id: tab.id, literals: new Map(), formulas: new Map(), formulaPlaces: [], computed: new Map() }
      for (const [address, cell] of Object.entries(tab.cells)) {
        const ref = parseCellRef(address)
        if (!ref?.inGrid) continue
        const at = place(ref.row, ref.col)
        if (cell.f !== undefined) state.formulas.set(at, cell.f)
        else state.literals.set(at, cell.v ?? null)
      }
      state.formulaPlaces = [...state.formulas.keys()]
      this.byName.set(tab.name.toLowerCase(), state)
      return state
    })
  }

  /** The value of one cell, working out whatever it depends on first. */
  value(tab: TabState, at: number): CellValue {
    if (tab.formulas.has(at)) this.resolve(tab, at)
    return this.read(tab, at)
  }

  private charge(cost: number) {
    this.work += cost
    if (this.work > MAX_WORK) throw new RangeError("This sheet is too large to work out.")
  }

  private read(tab: TabState, at: number): CellValue {
    this.charge(1)
    if (!tab.formulas.has(at)) return tab.literals.get(at) ?? null
    const value = tab.computed.get(at)
    if (value === undefined) throw new Error("A formula cell was read before it was worked out.")
    return value
  }

  /**
   * Works out a formula cell and everything under it with an explicit stack
   * rather than recursion, so a chain of thousands of cells cannot overflow
   * the call stack. A dependency already on the stack closes a cycle: every
   * cell on it is #CIRC!.
   */
  private resolve(tab: TabState, at: number) {
    if (tab.computed.has(at)) return
    const stack: Frame[] = []
    const onStack = new Map<number, number>()
    const push = (state: TabState, cell: number) => {
      const read = parseFormula(state.formulas.get(cell)!)
      const node = "node" in read ? read.node : null
      onStack.set(state.index * TAB_SHIFT + cell, stack.length)
      stack.push({ tab: state, at: cell, node, deps: node ? this.dependencies(state, node) : [], next: 0 })
    }

    push(tab, at)
    while (stack.length > 0) {
      const frame = stack.at(-1)!
      if (frame.next < frame.deps.length) {
        const dep = frame.deps[frame.next++]!
        const state = this.tabs[Math.floor(dep / TAB_SHIFT)]!
        const cell = dep % TAB_SHIFT
        if (state.computed.has(cell)) continue
        const open = onStack.get(dep)
        if (open === undefined) push(state, cell)
        else for (const member of stack.slice(open)) this.circular.add(member.tab.index * TAB_SHIFT + member.at)
        continue
      }

      stack.pop()
      const id = frame.tab.index * TAB_SHIFT + frame.at
      onStack.delete(id)
      frame.tab.computed.set(frame.at, this.circular.has(id) ? sheetError("#CIRC!") : frame.node ? this.finish(frame.tab, frame.node) : sheetError("#ERROR!"))
    }
  }

  private finish(tab: TabState, node: FormulaNode): CellValue {
    // A formula that reads an empty cell shows 0, as in Excel; a number past what a sheet holds is #NUM!.
    const value = scalar(this.evaluate(tab, node)) ?? 0
    return typeof value === "number" && !Number.isFinite(value) ? sheetError("#NUM!") : value
  }

  /** The formula cells a formula reads, as book-wide ids. */
  private dependencies(tab: TabState, node: FormulaNode): number[] {
    const out: number[] = []
    const visit = (part: FormulaNode) => {
      switch (part.k) {
        case "ref": {
          const target = this.tabFor(tab, part.sheet)
          const at = place(part.row, part.col)
          if (target?.formulas.has(at)) out.push(target.index * TAB_SHIFT + at)
          return
        }
        case "range": {
          const target = this.tabFor(tab, part.sheet)
          // A loop, not push(...ids): a range can hold more cells than a call takes arguments.
          if (target) for (const id of this.formulasIn(target, part)) out.push(id)
          return
        }
        case "neg":
        case "pos":
        case "pct":
          return visit(part.arg)
        case "bin":
          visit(part.left)
          return visit(part.right)
        case "call":
          return part.args.forEach(visit)
      }
    }
    visit(node)
    return out
  }

  private formulasIn(tab: TabState, range: Extract<FormulaNode, { k: "range" }>): number[] {
    const [top, bottom] = [Math.min(range.r1, range.r2), Math.max(range.r1, range.r2)]
    const [left, right] = [Math.min(range.c1, range.c2), Math.max(range.c1, range.c2)]
    const key = `${tab.index}:${top}:${left}:${bottom}:${right}`
    const known = this.rangeDeps.get(key)
    if (known) return known

    const size = (bottom - top + 1) * (right - left + 1)
    const found: number[] = []
    // Walk whichever is smaller: the range, or the tab's formula cells.
    this.charge(Math.min(size, tab.formulaPlaces.length))
    if (size <= tab.formulaPlaces.length) {
      for (let row = top; row <= bottom; row += 1) for (let col = left; col <= right; col += 1) if (tab.formulas.has(place(row, col))) found.push(tab.index * TAB_SHIFT + place(row, col))
    } else {
      for (const at of tab.formulaPlaces) {
        const [row, col] = [at >> COLUMN_BITS, at & (2 ** COLUMN_BITS - 1)]
        if (row >= top && row <= bottom && col >= left && col <= right) found.push(tab.index * TAB_SHIFT + at)
      }
    }
    this.rangeDeps.set(key, found)
    return found
  }

  private tabFor(tab: TabState, sheet: string | null): TabState | undefined {
    return sheet === null ? tab : this.byName.get(sheet.toLowerCase())
  }

  // Recursion here is bounded by the parser's depth cap; references are only
  // read, never followed, because resolve() has already worked them out.
  private evaluate(tab: TabState, node: FormulaNode): Result {
    switch (node.k) {
      case "num":
      case "str":
      case "bool":
        return node.v
      case "err":
        return sheetError(node.v)
      case "missing":
        return null
      case "name":
        return sheetError("#NAME?")
      case "ref": {
        const target = this.tabFor(tab, node.sheet)
        return target ? new Area(1, 1, () => this.read(target, place(node.row, node.col))) : sheetError("#REF!")
      }
      case "range": {
        const target = this.tabFor(tab, node.sheet)
        if (!target) return sheetError("#REF!")
        const [top, left] = [Math.min(node.r1, node.r2), Math.min(node.c1, node.c2)]
        return new Area(Math.abs(node.r2 - node.r1) + 1, Math.abs(node.c2 - node.c1) + 1, (row, col) => this.read(target, place(top + row, left + col)))
      }
      case "pos":
        return scalar(this.evaluate(tab, node.arg))
      case "neg":
      case "pct": {
        const value = toNumber(scalar(this.evaluate(tab, node.arg)))
        return isError(value) ? value : node.k === "neg" ? subtract(0, value) : divide(value, 100)
      }
      case "bin":
        return this.binary(node.op, scalar(this.evaluate(tab, node.left)), scalar(this.evaluate(tab, node.right)))
      case "call": {
        const definition = FUNCTIONS[node.name]
        if (!definition) return sheetError("#NAME?")
        if (node.args.length < definition.min || node.args.length > definition.max) return sheetError("#VALUE!")
        return definition.run(
          node.args.map((arg) => this.evaluate(tab, arg)),
          this.context
        )
      }
    }
  }

  private binary(op: Extract<FormulaNode, { k: "bin" }>["op"], left: CellValue, right: CellValue): CellValue {
    if (isError(left)) return left
    if (isError(right)) return right

    if (op === "&") {
      const [a, b] = [toText(left), toText(right)]
      if (isError(a)) return a
      if (isError(b)) return b
      return a.length + b.length > MAX_TEXT ? sheetError("#VALUE!") : a + b
    }

    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "^") {
      const [a, b] = [toNumber(left), toNumber(right)]
      if (isError(a)) return a
      if (isError(b)) return b
      return (op === "+" ? add : op === "-" ? subtract : op === "*" ? multiply : op === "/" ? divide : power)(a, b)
    }

    const order = compareValues(left, right)
    return op === "=" ? order === 0 : op === "<>" ? order !== 0 : op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : order >= 0
  }
}

function clock(now: Date, timeZone = "UTC"): FunctionContext {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, Number(part.value)])
  )
  const today = dateSerial(parts.year!, parts.month!, parts.day!)
  if (isError(today)) throw new RangeError("The date is outside what a sheet can hold.")
  return { today, now: today + (parts.hour! * 3600 + parts.minute! * 60 + parts.second!) / 86_400 }
}

const output = (value: CellValue) => (typeof value === "number" ? round15(value) : value)

/**
 * Works out every cell of a sheet.
 *
 * @param content - A sheet already through `parseSheetContent`.
 * @param options - The moment TODAY() and NOW() read, and whose calendar.
 * @returns Every cell's value and the cells in error.
 * @throws RangeError when the sheet is too large to work out.
 */
export function evaluateSheet(content: SheetContent, options: EvaluateOptions): SheetEvaluation {
  const book = new Workbook(content, clock(options.now, options.timeZone))
  const values = new Map<string, CellValue>()
  const errors = new Map<string, SheetErrorCode>()

  for (const [index, tab] of content.tabs.entries()) {
    for (const address of Object.keys(tab.cells)) {
      const ref = parseCellRef(address)
      if (!ref?.inGrid) continue
      const value = output(book.value(book.tabs[index]!, place(ref.row, ref.col)))
      values.set(`${tab.id}!${address}`, value)
      if (isError(value)) errors.set(`${tab.id}!${address}`, value.error)
    }
  }

  return { values, errors }
}

/**
 * Works out one cell, and only what it depends on.
 *
 * @param content - A sheet already through `parseSheetContent`.
 * @param tabId - The cell's tab.
 * @param address - The cell, "B12".
 * @param options - The moment TODAY() and NOW() read, and whose calendar.
 * @returns The cell's value; #REF! for a tab or address that does not exist.
 */
export function evaluateCell(content: SheetContent, tabId: string, address: string, options: EvaluateOptions): CellValue {
  const book = new Workbook(content, clock(options.now, options.timeZone))
  const tab = book.tabs.find((state) => state.id === tabId)
  const ref = parseCellRef(address)
  if (!tab || !ref?.inGrid) return sheetError("#REF!")
  return output(book.value(tab, place(ref.row, ref.col)))
}
