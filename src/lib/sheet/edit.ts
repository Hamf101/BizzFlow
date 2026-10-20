import { columnLabel, isInGrid, parseCellRef } from "@/lib/sheet/a1"
import { mapReferences, shiftFormula, type FormulaReference } from "@/lib/sheet/parse"
import { numberText, parseNumberText } from "@/lib/sheet/values"
import { SHEET_COLUMNS, SHEET_ROWS, type SheetCell, type SheetContent, type SheetFormat } from "@/types/sheet"

// The grid's edits, as pure changes to a sheet: what typing, fill, paste and
// inserting rows do to its cells and to the formulas that read them.

/** A cell's place, counted from 0. */
export type Point = { row: number; col: number }
/** A block of cells, corners included. */
export type Range = { top: number; left: number; bottom: number; right: number }
type Tab = SheetContent["tabs"][number]

export const cellAddress = (row: number, col: number) => `${columnLabel(col)}${row + 1}`

export const rangeOf = (a: Point, b: Point): Range => ({
  top: Math.min(a.row, b.row),
  left: Math.min(a.col, b.col),
  bottom: Math.max(a.row, b.row),
  right: Math.max(a.col, b.col),
})

/**
 * What a cell reads while it is edited: its formula, or its value as typed.
 *
 * @param cell - The stored cell, if any.
 * @returns The text for the formula bar.
 */
export function cellInput(cell: SheetCell | undefined): string {
  if (cell?.f !== undefined) return `=${cell.f}`
  const value = cell?.v
  if (value === undefined || value === null) return ""
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return typeof value === "number" ? numberText(value) : value
}

/**
 * Reads what someone typed as Excel does: "=" starts a formula, numbers,
 * percentages and ISO dates become numbers in that format, TRUE and FALSE
 * become logicals, a leading apostrophe keeps text as text. The cell keeps
 * its format; an empty one with no format is gone.
 *
 * @param text - What was typed.
 * @param format - The cell's format.
 * @returns The cell, or null to clear it.
 */
export function typedCell(text: string, format?: SheetFormat): SheetCell | null {
  const kept = format ? { fmt: format } : {}
  if (text === "") return format ? kept : null
  if (text.startsWith("=") && text.length > 1) return { f: text.slice(1), ...kept }
  if (text.startsWith("'") || format?.type === "text") return { v: text.startsWith("'") ? text.slice(1) : text, ...kept }
  if (/^(true|false)$/i.test(text)) return { v: text.toUpperCase() === "TRUE", ...kept }

  const number = parseNumberText(text)
  if (number === null) return { v: text, ...kept }
  if (format && format.type !== "general") return { v: number, fmt: format }
  const type = /%\s*$/.test(text) ? "percent" : /^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/.test(text) ? "date" : null
  return { v: number, ...(type ? { fmt: { ...format, type } } : kept) }
}

/** The sheet with one tab's cells changed; null clears a cell. */
export function withCells(content: SheetContent, tabId: string, updates: ReadonlyMap<string, SheetCell | null>): SheetContent {
  return changeTab(content, tabId, (tab) => {
    const cells = { ...tab.cells }
    for (const [address, cell] of updates) {
      if (cell) cells[address] = cell
      else delete cells[address]
    }
    return { ...tab, cells }
  })
}

function changeTab(content: SheetContent, tabId: string, change: (tab: Tab) => Tab): SheetContent {
  return { ...content, tabs: content.tabs.map((tab) => (tab.id === tabId ? change(tab) : tab)) }
}

function* addresses(range: Range): Generator<[string, number, number]> {
  for (let row = range.top; row <= range.bottom; row += 1)
    for (let col = range.left; col <= range.right; col += 1) yield [cellAddress(row, col), row, col]
}

// Formatting a large empty block would write a cell for each; past this, only filled cells change.
const MAX_FORMATTED_BLANKS = 10_000

/**
 * Changes the format of every cell in a block, empty ones too while the block is small.
 *
 * @param change - The cell's new format from its old one; undefined for General.
 */
export function formatCells(
  content: SheetContent,
  tabId: string,
  range: Range,
  change: (format: SheetFormat | undefined) => SheetFormat | undefined
): SheetContent {
  const cells = content.tabs.find((tab) => tab.id === tabId)?.cells ?? {}
  const blanks = (range.bottom - range.top + 1) * (range.right - range.left + 1) <= MAX_FORMATTED_BLANKS
  const updates = new Map<string, SheetCell | null>()
  for (const [address] of addresses(range)) {
    const cell = cells[address]
    if (!cell && !blanks) continue
    const fmt = change(cell?.fmt)
    const rest = { ...cell }
    delete rest.fmt
    updates.set(address, fmt ? { ...rest, fmt } : Object.keys(rest).length > 0 ? rest : null)
  }
  return withCells(content, tabId, updates)
}

/**
 * Ctrl+D: the block's top row copied down through it, formulas moved as they
 * go. A single row takes the row above it.
 */
export function fillDown(content: SheetContent, tabId: string, range: Range): SheetContent {
  const source = range.top === range.bottom ? range.top - 1 : range.top
  if (source < 0) return content
  const cells = content.tabs.find((tab) => tab.id === tabId)?.cells ?? {}
  const updates = new Map<string, SheetCell | null>()
  for (const [address, row, col] of addresses({ ...range, top: source + 1 })) {
    const from = cells[cellAddress(source, col)]
    updates.set(address, from?.f === undefined ? (from ?? null) : { ...from, f: shiftFormula(from.f, row - source, 0) })
  }
  return withCells(content, tabId, updates)
}

/**
 * Writes a block of cells with its top-left at `at`; what falls off the grid is dropped.
 *
 * @param from - Where the block was copied from: its formulas move by the distance. Without it they land as written.
 */
export function pasteCells(content: SheetContent, tabId: string, at: Point, block: ReadonlyArray<ReadonlyArray<SheetCell | null>>, from?: Point): SheetContent {
  const updates = new Map<string, SheetCell | null>()
  block.forEach((line, dr) =>
    line.forEach((cell, dc) => {
      const row = at.row + dr
      const col = at.col + dc
      if (!isInGrid(row, col)) return
      const moved = cell?.f !== undefined && from ? { ...cell, f: shiftFormula(cell.f, at.row - from.row, at.col - from.col) } : cell
      updates.set(cellAddress(row, col), moved)
    })
  )
  return withCells(content, tabId, updates)
}

/**
 * Puts a cut block down with its top-left at `at`, as Excel's cut does: its
 * formulas land as written, and every reference that read inside where it was
 * cut from, on any tab, follows it there.
 *
 * @param from - Where on this tab the block was cut from, already cleared.
 */
export function moveCells(content: SheetContent, tabId: string, from: Range, at: Point, block: ReadonlyArray<ReadonlyArray<SheetCell | null>>): SheetContent {
  const target = content.tabs.find((tab) => tab.id === tabId)
  if (!target) return content
  const within = (ref: Point) => ref.row >= from.top && ref.row <= from.bottom && ref.col >= from.left && ref.col <= from.right
  const follow = <T extends Point>(ref: T): T => ({ ...ref, row: ref.row + at.row - from.top, col: ref.col + at.col - from.left })

  return rewriteFormulas(pasteCells(content, tabId, at, block), (tab, reference) => {
    if (!readsTab(tab, reference, target) || !within(reference.first) || !within(reference.last ?? reference.first)) return reference
    const first = follow(reference.first)
    const last = reference.last && follow(reference.last)
    return isInGrid(first.row, first.col) && (!last || isInGrid(last.row, last.col)) ? { ...reference, first, last } : null
  })
}

/** Tab-separated text as Excel and Google Sheets put it on the clipboard: fields with tabs, line breaks or quotes are quoted. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [[]]
  let field = ""
  let quoted = false
  const end = () => {
    rows.at(-1)!.push(field)
    field = ""
  }
  const body = text.replace(/\r\n?/g, "\n").replace(/\n$/, "")
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at]!
    if (quoted) {
      if (char !== '"') field += char
      else if (body[at + 1] === '"') {
        field += '"'
        at += 1
      } else quoted = false
    } else if (char === '"' && field === "") quoted = true
    else if (char === "\t") end()
    else if (char === "\n") {
      end()
      rows.push([])
    } else field += char
  }
  end()
  return rows
}

export function toTsv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((row) => row.map((field) => (/[\t\n"]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field)).join("\t")).join("\n")
}

/**
 * Inserts (count > 0, before `at`) or deletes (count < 0, from `at`) whole rows
 * or columns of one tab. Every formula that reads the tab follows its cells;
 * one that read deleted cells reads #REF!, as in Excel.
 *
 * @returns The sheet, or null when an insert would push filled cells off the grid.
 */
export function moveLines(content: SheetContent, tabId: string, axis: "row" | "col", at: number, count: number): SheetContent | null {
  const size = axis === "row" ? SHEET_ROWS : SHEET_COLUMNS
  const target = content.tabs.find((tab) => tab.id === tabId)
  if (!target) return content
  const place = (ref: { row: number; col: number }) => (axis === "row" ? ref.row : ref.col)
  const put = <T extends { row: number; col: number }>(ref: T, value: number): T => (axis === "row" ? { ...ref, row: value } : { ...ref, col: value })
  // Where a line lands, or null when it is deleted; `edge` is how a range's end clamps into a deleted run.
  const land = (value: number, edge?: "start" | "end"): number | null => {
    if (value < at) return value
    if (count > 0) return value + count < size ? value + count : null
    if (value >= at - count) return value + count
    return edge === "start" ? at : edge === "end" ? at - 1 : null
  }

  const cells: Tab["cells"] = {}
  for (const [address, cell] of Object.entries(target.cells)) {
    const ref = parseCellRef(address)!
    const next = land(place(ref))
    if (next === null) {
      if (count > 0) return null
      continue
    }
    const moved = put(ref, next)
    cells[cellAddress(moved.row, moved.col)] = cell
  }

  const moveRef = ({ first, last, sheet }: FormulaReference): FormulaReference | null => {
    if (!last) {
      const next = land(place(first))
      return next === null ? null : { first: put(first, next), last, sheet }
    }
    const start = land(place(first), "start")
    const end = land(place(last), "end")
    return start === null || end === null || end < start ? null : { first: put(first, start), last: put(last, end), sheet }
  }

  const cols =
    axis === "col" && target.cols
      ? Object.fromEntries(
          Object.entries(target.cols).flatMap(([label, width]) => {
            const next = land(parseCellRef(`${label}1`)!.col)
            return next === null ? [] : [[columnLabel(next), width]]
          })
        )
      : target.cols

  return rewriteFormulas({ ...content, tabs: content.tabs.map((tab) => (tab.id === tabId ? { ...tab, cells, ...(cols ? { cols } : {}) } : tab)) }, (tab, reference) =>
    readsTab(tab, reference, target) ? moveRef(reference) : reference
  )
}

// Whether a reference written on `tab` reads `target`.
function readsTab(tab: Tab, reference: FormulaReference, target: Tab): boolean {
  return reference.sheet === null ? tab.id === target.id : reference.sheet.toLowerCase() === target.name.toLowerCase()
}

function rewriteFormulas(content: SheetContent, move: (tab: Tab, reference: FormulaReference) => FormulaReference | null): SheetContent {
  return {
    ...content,
    tabs: content.tabs.map((tab) => ({
      ...tab,
      cells: Object.fromEntries(
        Object.entries(tab.cells).map(([address, cell]) => [address, cell.f === undefined ? cell : { ...cell, f: mapReferences(cell.f, (reference) => move(tab, reference)) }])
      ),
    })),
  }
}

/** A new empty tab at the end, named Sheet2, Sheet3… as Excel does. */
export function addTab(content: SheetContent, id: string): SheetContent {
  const names = new Set(content.tabs.map((tab) => tab.name.toLowerCase()))
  let number = content.tabs.length + 1
  while (names.has(`sheet${number}`)) number += 1
  return { ...content, tabs: [...content.tabs, { id, name: `Sheet${number}`, cells: {} }] }
}

/** Renames a tab, and every formula that names it. */
export function renameTab(content: SheetContent, tabId: string, name: string): SheetContent {
  const target = content.tabs.find((tab) => tab.id === tabId)
  if (!target) return content
  const renamed = { ...content, tabs: content.tabs.map((tab) => (tab.id === tabId ? { ...tab, name } : tab)) }
  return rewriteFormulas(renamed, (tab, reference) => (reference.sheet !== null && readsTab(tab, reference, target) ? { ...reference, sheet: name } : reference))
}

/** Deletes a tab; formulas elsewhere that read it read #REF!. */
export function deleteTab(content: SheetContent, tabId: string): SheetContent {
  const target = content.tabs.find((tab) => tab.id === tabId)
  if (!target || content.tabs.length === 1) return content
  return rewriteFormulas({ ...content, tabs: content.tabs.filter((tab) => tab.id !== tabId) }, (tab, reference) =>
    reference.sheet !== null && readsTab(tab, reference, target) ? null : reference
  )
}
