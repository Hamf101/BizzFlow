import Big from "big.js"

import {
  Area,
  MAX_TEXT,
  compareNumbers,
  compareText,
  compareValues,
  dateSerial,
  divide,
  isError,
  multiply,
  numberText,
  parseNumberText,
  power,
  roundTo,
  scalar,
  serialDate,
  sheetError,
  subtract,
  toBoolean,
  toNumber,
  toText,
  type CellValue,
  type Result,
  type SheetError,
} from "@/lib/sheet/values"

// The functions a sheet can call, hand-written to Microsoft's documented
// behaviour. Each takes its arguments already worked out: a reference or range
// arrives as an Area (so SUM can skip the text in it), anything else as a value.

/** The moment a sheet is worked out at, as serials: TODAY() and NOW(). */
export type FunctionContext = { today: number; now: number }
type SheetFunction = { min: number; max: number; run: (args: Result[], context: FunctionContext) => Result }

const VALUE = sheetError("#VALUE!")
const NA = sheetError("#N/A")
const NUM = sheetError("#NUM!")
const REF = sheetError("#REF!")
const DIV0 = sheetError("#DIV/0!")
const MANY = 255

const fn = (min: number, max: number, run: SheetFunction["run"]): SheetFunction => ({ min, max, run })

/** An argument used as one value; an argument left out is an empty cell. */
const one = (arg: Result | undefined): CellValue => (arg === undefined ? null : scalar(arg))

/** Works out `run` once every argument reads as a number; the first that cannot is the answer. */
function withNumbers(args: Array<Result | number | undefined>, run: (...values: number[]) => Result): Result {
  const values: number[] = []
  for (const arg of args) {
    const value = typeof arg === "number" ? arg : toNumber(one(arg))
    if (isError(value)) return value
    values.push(value)
  }
  return run(...values)
}

function withText(arg: Result | undefined, run: (text: string) => Result): Result {
  const text = toText(one(arg))
  return isError(text) ? text : run(text)
}

const asArea = (arg: Result): Area => (arg instanceof Area ? arg : new Area(1, 1, () => arg))
const flatten = (args: Result[]): CellValue[] => args.flatMap((arg) => (arg instanceof Area ? arg.values() : [arg]))
const firstError = (values: CellValue[]) => values.find(isError)

/**
 * The numbers an aggregate reads. In a range only numbers count (text,
 * TRUE/FALSE and blanks are skipped); a value typed straight in is coerced, so
 * SUM("2", TRUE) is 3. An error anywhere is the answer.
 */
function numbersOf(args: Result[]): number[] | SheetError {
  const out: number[] = []
  for (const arg of args) {
    if (arg instanceof Area) {
      for (const value of arg.values()) {
        if (typeof value === "number") out.push(value)
        else if (isError(value)) return value
      }
    } else {
      const value = toNumber(arg)
      if (isError(value)) return value
      out.push(value)
    }
  }
  return out
}

const finiteOr = (value: number) => (Number.isFinite(value) ? value : NUM)
const sum = (values: number[]) => Number(values.reduce((total, value) => total.plus(value), new Big(0)))

function aggregate(run: (values: number[]) => Result) {
  return fn(1, MANY, (args) => {
    const values = numbersOf(args)
    if (isError(values)) return values
    const result = run(values)
    return typeof result === "number" ? finiteOr(result) : result
  })
}

/** TRUE/FALSE for AND and OR: from a range, booleans and numbers; text in a range is skipped. */
function logicals(args: Result[]): boolean[] | SheetError {
  const out: boolean[] = []
  for (const arg of args) {
    for (const value of arg instanceof Area ? arg.values() : [arg]) {
      if (isError(value)) return value
      if (arg instanceof Area && (typeof value === "string" || value === null)) continue
      const logical = toBoolean(value)
      if (isError(logical)) return logical
      out.push(logical)
    }
  }
  return out.length === 0 ? VALUE : out
}

// --- Criteria (SUMIF, COUNTIFS…) and wildcards ------------------------------

const ANY = -1
const ONE = -2

/** "Pai*", "P?id", "~*" (a literal *), matched without regard to case. */
function wildcard(pattern: string): (text: string) => boolean {
  const parts: Array<string | number> = []
  const lower = pattern.toLowerCase()
  for (let at = 0; at < lower.length; at += 1) {
    const char = lower[at]!
    if (char === "~" && at + 1 < lower.length) parts.push(lower[++at]!)
    else parts.push(char === "*" ? ANY : char === "?" ? ONE : char)
  }

  // Greedy match that backs up to the last *: no regex, so no runaway backtracking.
  return (input) => {
    const text = input.toLowerCase()
    let p = 0
    let t = 0
    let star = -1
    let resume = 0
    while (t < text.length) {
      if (p < parts.length && (parts[p] === ONE || parts[p] === text[t])) {
        p += 1
        t += 1
      } else if (p < parts.length && parts[p] === ANY) {
        star = p
        p += 1
        resume = t
      } else if (star >= 0) {
        p = star + 1
        resume += 1
        t = resume
      } else return false
    }
    while (parts[p] === ANY) p += 1
    return p === parts.length
  }
}

type Comparison = "=" | "<>" | "<" | ">" | "<=" | ">="

const holds = (op: Comparison, order: number) =>
  op === "=" ? order === 0 : op === "<>" ? order !== 0 : op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : order >= 0

const isBlank = (value: CellValue) => value === null || value === ""

/**
 * A criterion as the *IF functions read it: 100, ">=100", "<>Paid", "Pai*",
 * "" (blank) or "<>" (not blank). A number criterion also matches text that
 * reads as that number, as Excel's COUNTIF does.
 */
function criterion(value: Exclude<CellValue, SheetError>): (cell: CellValue) => boolean {
  if (typeof value === "boolean") return (cell) => cell === value
  if (typeof value === "number" || value === null) return numberTest("=", value ?? 0)

  const [, op = "=", operand = ""] = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(value) as unknown as [string, Comparison | undefined, string]
  if (operand === "") return op === "=" ? isBlank : op === "<>" ? (cell) => !isBlank(cell) : () => false

  const number = parseNumberText(operand)
  if (number !== null) return numberTest(op, number)

  const upper = operand.toUpperCase()
  if (upper === "TRUE" || upper === "FALSE") return (cell) => (op === "<>" ? cell !== (upper === "TRUE") : op === "=" && cell === (upper === "TRUE"))

  if (op === "=" || op === "<>") {
    const matches = wildcard(operand)
    return (cell) => (typeof cell === "string" && matches(cell)) === (op === "=")
  }
  return (cell) => typeof cell === "string" && holds(op, compareText(cell, operand))
}

function numberTest(op: Comparison, number: number): (cell: CellValue) => boolean {
  return (cell) => {
    const value = typeof cell === "number" ? cell : typeof cell === "string" && (op === "=" || op === "<>") ? parseNumberText(cell) : null
    return value === null ? op === "<>" : holds(op, compareNumbers(value, number))
  }
}

/**
 * The cells of `target` whose row and column pass every (range, criterion)
 * pair, all ranges the same shape.
 */
function matching(target: Result, pairs: Result[]): CellValue[] | SheetError {
  const area = asArea(target)
  const tests: Array<[Area, (cell: CellValue) => boolean]> = []
  for (let at = 0; at < pairs.length; at += 2) {
    const range = asArea(pairs[at]!)
    const wanted = one(pairs[at + 1])
    if (isError(wanted)) return wanted
    if (range.height !== area.height || range.width !== area.width) return VALUE
    tests.push([range, criterion(wanted)])
  }
  const out: CellValue[] = []
  for (let row = 0; row < area.height; row += 1)
    for (let column = 0; column < area.width; column += 1)
      if (tests.every(([range, test]) => test(range.at(row, column)))) out.push(area.at(row, column))
  return out
}

/** Sums or averages the numbers among matched cells; a matched error is the answer. */
function matchedNumbers(cells: CellValue[] | SheetError, run: (values: number[]) => Result): Result {
  if (isError(cells)) return cells
  const error = firstError(cells)
  return error ?? run(cells.filter((cell): cell is number => typeof cell === "number"))
}

const average = (values: number[]) => (values.length === 0 ? DIV0 : divide(sum(values), values.length))

// --- Lookups -----------------------------------------------------------------

type Plain = Exclude<CellValue, SheetError>

/** Exact match: same kind of value, text without regard to case, wildcards when asked. */
function sameAs(wanted: Plain, wildcards: boolean): (cell: CellValue) => boolean {
  if (typeof wanted === "string" && wildcards) {
    const matches = wildcard(wanted)
    return (cell) => typeof cell === "string" && matches(cell)
  }
  return (cell) => !isError(cell) && cell !== null && typeof cell === typeof wanted && compareValues(cell, wanted) === 0
}

/**
 * Approximate match over data sorted ascending (direction 1: the last value at
 * or below) or descending (-1: the last value at or above), stopping where the
 * order passes the wanted value, as a lookup over sorted data does.
 */
function sortedPosition(get: (at: number) => CellValue, length: number, wanted: Plain, direction: 1 | -1): number {
  let found = -1
  for (let at = 0; at < length; at += 1) {
    const cell = get(at)
    if (isError(cell) || cell === null || typeof cell !== typeof wanted) continue
    if (compareValues(cell, wanted) * direction > 0) break
    found = at
  }
  return found
}

/** VLOOKUP's search, HLOOKUP running it over the table turned on its side. */
function verticalLookup(args: Result[], table: Area): Result {
  const wanted = one(args[0])
  if (isError(wanted)) return wanted
  const approximate = toBoolean(args[3] === undefined ? true : one(args[3]))
  if (isError(approximate)) return approximate
  return withNumbers([args[2]], (index) => {
    const column = Math.trunc(index)
    if (column < 1) return VALUE
    if (column > table.width) return REF
    const get = (at: number) => table.at(at, 0)
    let row = -1
    if (approximate) row = sortedPosition(get, table.height, wanted, 1)
    else for (let at = 0, test = sameAs(wanted, true); at < table.height && row < 0; at += 1) if (test(get(at))) row = at
    return row < 0 ? NA : table.at(row, column - 1)
  })
}

const line = (area: Area) => ({
  length: area.height === 1 ? area.width : area.height,
  get: (at: number) => (area.height === 1 ? area.at(0, at) : area.at(at, 0)),
  oneDimensional: area.height === 1 || area.width === 1,
})

/** Which cell XLOOKUP picks: exact, or the nearest below (-1) or above (1); searching first-to-last or back. */
function xlookupPosition(get: (at: number) => CellValue, length: number, wanted: Plain, mode: number, search: number): number {
  const exact = sameAs(wanted, mode === 2)
  let best = -1
  for (let step = 0; step < length; step += 1) {
    const at = search === 1 ? step : length - 1 - step
    const cell = get(at)
    if (exact(cell)) return at
    if (mode === 0 || mode === 2 || isError(cell) || cell === null || typeof cell !== typeof wanted) continue
    const order = compareValues(cell, wanted)
    if (order * mode > 0 && (best < 0 || compareValues(cell, get(best) as Plain) * mode < 0)) best = at
  }
  return best
}

// --- Dates -------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Excel's weekday for a serial, Sunday 0. It counts from serial 1 as a Sunday, as Excel does. */
const weekday = (serial: number) => (Math.floor(serial) + 6) % 7

function withDate(arg: Result | undefined, run: (date: { year: number; month: number; day: number }, serial: number) => Result): Result {
  return withNumbers([arg], (serial) => {
    const date = serialDate(serial)
    return isError(date) ? date : run(date, serial)
  })
}

const pad = (value: number, size = 2) => String(value).padStart(size, "0")
const DATE_TOKEN = /yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|[-/ ,.:]/giy
const NUMBER_FORMAT = /^([$€£]?)([#0,]*)(?:\.([0#]+))?(%?)$/

/** TEXT's format codes: "0.00", "#,##0", "0%", "$#,##0.00", "dd/mm/yyyy", "mmm yyyy", "hh:mm". */
function formatText(value: number, format: string): string | SheetError {
  if (format.toLowerCase() === "general") return numberText(value)
  if (/[dmyhs]/i.test(format)) return formatDate(value, format)

  const match = NUMBER_FORMAT.exec(format)
  if (!match || !/[#0]/.test(format)) return VALUE
  const [, prefix = "", whole = "", fraction = "", percent] = match
  const scaled = percent ? multiply(value, 100) : value
  if (isError(scaled)) return scaled

  const fixed = new Big(Math.abs(scaled)).round(fraction.length, Big.roundHalfUp).toFixed(fraction.length)
  let [digits = "", decimals = ""] = fixed.split(".")
  const keep = fraction.replace(/#+$/, "").length
  decimals = decimals.slice(0, keep) + decimals.slice(keep).replace(/0+$/, "")
  const minimum = (whole.match(/0/g) ?? []).length
  if (digits === "0" && minimum === 0) digits = ""
  digits = digits.padStart(minimum, "0")
  if (whole.includes(",")) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")

  const sign = scaled < 0 && /[1-9]/.test(fixed) ? "-" : ""
  return `${sign}${prefix}${digits}${fraction ? "." : ""}${decimals}${percent}`
}

function formatDate(value: number, format: string): string | SheetError {
  const date = serialDate(value)
  if (isError(date)) return VALUE
  const seconds = Math.round((value - Math.floor(value)) * 86_400)
  const tokens: string[] = []
  for (DATE_TOKEN.lastIndex = 0; DATE_TOKEN.lastIndex < format.length; ) {
    const token = DATE_TOKEN.exec(format)
    if (!token) return VALUE
    tokens.push(token[0])
  }

  const isUnit = (token: string | undefined, unit: string) => token !== undefined && token.toLowerCase().startsWith(unit)
  const nearest = (from: number, step: number) => {
    for (let at = from + step; at >= 0 && at < tokens.length; at += step) if (/[a-z]/i.test(tokens[at]!)) return tokens[at]
    return undefined
  }

  return tokens
    .map((token, at) => {
      const lower = token.toLowerCase()
      // "m" after an hour or before seconds is minutes.
      if (lower.startsWith("m") && lower.length <= 2 && (isUnit(nearest(at, -1), "h") || isUnit(nearest(at, 1), "s")))
        return lower === "mm" ? pad(Math.floor(seconds / 60) % 60) : String(Math.floor(seconds / 60) % 60)
      switch (lower) {
        case "yyyy": return pad(date.year, 4)
        case "yy": return pad(date.year % 100)
        case "mmmm": return MONTH_NAMES[date.month - 1]!
        case "mmm": return MONTH_NAMES[date.month - 1]!.slice(0, 3)
        case "mm": return pad(date.month)
        case "m": return String(date.month)
        case "dddd": return DAY_NAMES[weekday(value)]!
        case "ddd": return DAY_NAMES[weekday(value)]!.slice(0, 3)
        case "dd": return pad(date.day)
        case "d": return String(date.day)
        case "hh": return pad(Math.floor(seconds / 3600) % 24)
        case "h": return String(Math.floor(seconds / 3600) % 24)
        case "ss": return pad(seconds % 60)
        case "s": return String(seconds % 60)
        default: return token
      }
    })
    .join("")
}

// --- Text --------------------------------------------------------------------

/** Joins text, refusing to pass the 32,767 characters a cell holds. */
function joinCapped(values: CellValue[], separator = "", skipEmpty = false): Result {
  const parts: string[] = []
  let length = 0
  for (const value of values) {
    const text = toText(value)
    if (isError(text)) return text
    if (skipEmpty && text === "") continue
    length += text.length + (parts.length > 0 ? separator.length : 0)
    if (length > MAX_TEXT) return VALUE
    parts.push(text)
  }
  return parts.join(separator)
}

function substitute(text: string, old: string, replacement: string, instance: number | undefined): Result {
  if (old === "") return text
  if (instance !== undefined) {
    if (instance < 1) return VALUE
    let at = -1
    for (let seen = 0; seen < instance; seen += 1) {
      at = text.indexOf(old, at + 1)
      if (at < 0) return text
    }
    return joinCapped([text.slice(0, at), replacement, text.slice(at + old.length)])
  }
  const pieces = text.split(old)
  return text.length + (pieces.length - 1) * (replacement.length - old.length) > MAX_TEXT ? VALUE : pieces.join(replacement)
}

// --- The table ---------------------------------------------------------------

const round = (mode: "half" | "up" | "down") => fn(2, 2, (args) => withNumbers(args, (value, places) => roundTo(value, places, mode)))
const dateParts = (part: "year" | "month" | "day") => fn(1, 1, (args) => withDate(args[0], (date) => date[part]))
const countIf = (max: number) =>
  fn(2, max, (args) => {
    const cells = args.length % 2 === 1 ? VALUE : matching(args[0]!, args)
    return isError(cells) ? cells : cells.length
  })

export const FUNCTIONS: Record<string, SheetFunction> = {
  // Logic
  IF: fn(2, 3, (args) => {
    const test = toBoolean(one(args[0]))
    if (isError(test)) return test
    return test ? args[1]! : args.length > 2 ? args[2]! : false
  }),
  IFS: fn(2, MANY, (args) => {
    if (args.length % 2 === 1) return VALUE
    for (let at = 0; at < args.length; at += 2) {
      const test = toBoolean(one(args[at]))
      if (isError(test)) return test
      if (test) return args[at + 1]!
    }
    return NA
  }),
  AND: fn(1, MANY, (args) => {
    const values = logicals(args)
    return isError(values) ? values : values.every(Boolean)
  }),
  OR: fn(1, MANY, (args) => {
    const values = logicals(args)
    return isError(values) ? values : values.some(Boolean)
  }),
  NOT: fn(1, 1, (args) => {
    const value = toBoolean(one(args[0]))
    return isError(value) ? value : !value
  }),
  IFERROR: fn(2, 2, (args) => (isError(one(args[0])) ? args[1]! : args[0]!)),
  IFNA: fn(2, 2, (args) => (one(args[0]) === NA ? args[1]! : args[0]!)),

  // Maths
  SUM: aggregate(sum),
  AVERAGE: aggregate(average),
  MIN: aggregate((values) => (values.length === 0 ? 0 : values.reduce((low, value) => Math.min(low, value)))),
  MAX: aggregate((values) => (values.length === 0 ? 0 : values.reduce((high, value) => Math.max(high, value)))),
  PRODUCT: aggregate((values) => (values.length === 0 ? 0 : finiteOr(values.reduce((total, value) => (Number.isFinite(total) ? Number(new Big(total).times(value)) : total), 1)))),
  COUNT: fn(1, MANY, (args) =>
    args.reduce<number>((count, arg) => count + (arg instanceof Area ? arg.values().filter((value) => typeof value === "number").length : isError(toNumber(arg)) ? 0 : 1), 0)
  ),
  COUNTA: fn(1, MANY, (args) => flatten(args).filter((value) => value !== null).length),
  COUNTBLANK: fn(1, 1, (args) => (args[0] instanceof Area ? args[0].values().filter(isBlank).length : VALUE)),
  ROUND: round("half"),
  ROUNDUP: round("up"),
  ROUNDDOWN: round("down"),
  ABS: fn(1, 1, (args) => withNumbers(args, Math.abs)),
  INT: fn(1, 1, (args) => withNumbers(args, Math.floor)),
  SQRT: fn(1, 1, (args) => withNumbers(args, (value) => (value < 0 ? NUM : Math.sqrt(value)))),
  POWER: fn(2, 2, (args) => withNumbers(args, power)),
  MOD: fn(2, 2, (args) =>
    withNumbers(args, (value, divisor) => {
      const quotient = divide(value, divisor)
      if (isError(quotient)) return quotient
      const product = multiply(divisor, Math.floor(quotient))
      return isError(product) ? product : subtract(value, product)
    })
  ),

  // Conditional aggregates
  COUNTIF: countIf(2),
  COUNTIFS: countIf(MANY),
  SUMIF: fn(2, 3, (args) => matchedNumbers(matching(args[2] ?? args[0]!, [args[0]!, args[1]!]), sum)),
  SUMIFS: fn(3, MANY, (args) => (args.length % 2 === 0 ? VALUE : matchedNumbers(matching(args[0]!, args.slice(1)), sum))),
  AVERAGEIF: fn(2, 3, (args) => matchedNumbers(matching(args[2] ?? args[0]!, [args[0]!, args[1]!]), average)),

  // Lookups
  VLOOKUP: fn(3, 4, (args) => verticalLookup(args, asArea(args[1]!))),
  HLOOKUP: fn(3, 4, (args) => {
    const table = asArea(args[1]!)
    return verticalLookup(args, new Area(table.width, table.height, (row, column) => table.at(column, row)))
  }),
  MATCH: fn(2, 3, (args) => {
    const wanted = one(args[0])
    if (isError(wanted)) return wanted
    const list = line(asArea(args[1]!))
    if (!list.oneDimensional) return NA
    return withNumbers([args[2] ?? 1], (type) => {
      let at = -1
      if (type === 0) for (let index = 0, test = sameAs(wanted, true); index < list.length && at < 0; index += 1) at = test(list.get(index)) ? index : -1
      else at = sortedPosition(list.get, list.length, wanted, type > 0 ? 1 : -1)
      return at < 0 ? NA : at + 1
    })
  }),
  INDEX: fn(2, 3, (args) => {
    const area = asArea(args[0]!)
    return withNumbers([args[1], args[2] ?? 0], (first, second) => {
      // In a single row, one number picks the column.
      const [row, column] = (area.height === 1 && args.length === 2 ? [1, first] : [first, second]).map(Math.trunc) as [number, number]
      if (row < 0 || column < 0) return VALUE
      if (row > area.height || column > area.width) return REF
      if (row > 0 && column > 0) return area.at(row - 1, column - 1)
      if (row > 0) return new Area(1, area.width, (_, at) => area.at(row - 1, at))
      if (column > 0) return new Area(area.height, 1, (at) => area.at(at, column - 1))
      return area
    })
  }),
  XLOOKUP: fn(3, 6, (args) => {
    const wanted = one(args[0])
    if (isError(wanted)) return wanted
    const look = asArea(args[1]!)
    const back = asArea(args[2]!)
    const list = line(look)
    const vertical = look.width === 1
    if (!list.oneDimensional || (vertical ? back.height !== look.height : back.width !== look.width)) return VALUE
    return withNumbers([args[4] ?? 0, args[5] ?? 1], (mode, search) => {
      if (![0, -1, 1, 2].includes(mode) || ![1, -1].includes(search)) return VALUE
      const at = xlookupPosition(list.get, list.length, wanted, mode, search)
      if (at < 0) return args[3] === undefined || args[3] === null ? NA : args[3]
      if (vertical) return back.width === 1 ? back.at(at, 0) : new Area(1, back.width, (_, column) => back.at(at, column))
      return back.height === 1 ? back.at(0, at) : new Area(back.height, 1, (row) => back.at(row, at))
    })
  }),

  // Dates
  TODAY: fn(0, 0, (_, context) => context.today),
  NOW: fn(0, 0, (_, context) => context.now),
  DATE: fn(3, 3, (args) => withNumbers(args, (year, month, day) => dateSerial(Math.trunc(year), Math.trunc(month), Math.trunc(day)))),
  YEAR: dateParts("year"),
  MONTH: dateParts("month"),
  DAY: dateParts("day"),
  EDATE: fn(2, 2, (args) =>
    withDate(args[0], ({ year, month, day }) =>
      withNumbers([args[1]], (months) => {
        const target = month + Math.trunc(months)
        const last = dateSerial(year, target + 1, 0)
        const wanted = dateSerial(year, target, day)
        return isError(last) ? last : isError(wanted) ? wanted : Math.min(last, wanted)
      })
    )
  ),
  EOMONTH: fn(2, 2, (args) => withDate(args[0], ({ year, month }) => withNumbers([args[1]], (months) => dateSerial(year, month + Math.trunc(months) + 1, 0)))),
  DATEDIF: fn(3, 3, (args) =>
    withNumbers([args[0], args[1]], (start, end) =>
      withText(args[2], (unit) => {
        const [from, to] = [serialDate(start), serialDate(end)]
        if (isError(from) || isError(to) || Math.floor(start) > Math.floor(end)) return NUM
        const months = (to.year - from.year) * 12 + to.month - from.month - (to.day < from.day ? 1 : 0)
        const upper = unit.toUpperCase()
        return upper === "D" ? Math.floor(end) - Math.floor(start) : upper === "M" ? months : upper === "Y" ? Math.floor(months / 12) : NUM
      })
    )
  ),
  WEEKDAY: fn(1, 2, (args) =>
    withNumbers([args[0], args[1] ?? 1], (serial, type) => {
      if (serial < 0) return NUM
      // Type 1: Sunday is 1. Type 2: Monday is 1. Type 3: Monday is 0. 11–17: Monday…Sunday is 1.
      const start = type === 1 ? 0 : type === 2 || type === 3 ? 1 : type >= 11 && type <= 17 ? (type - 10) % 7 : -1
      return start < 0 ? NUM : ((weekday(serial) - start + 7) % 7) + (type === 3 ? 0 : 1)
    })
  ),

  // Text
  TEXT: fn(2, 2, (args) => {
    const value = one(args[0])
    return withText(args[1], (format) => {
      if (isError(value)) return value
      if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
      const number = typeof value === "string" ? parseNumberText(value) : (value ?? 0)
      return number === null ? value : formatText(number, format)
    })
  }),
  CONCAT: fn(1, MANY, (args) => joinCapped(flatten(args))),
  CONCATENATE: fn(1, MANY, (args) => joinCapped(args.map(one))),
  TEXTJOIN: fn(3, MANY, (args) =>
    withText(args[0], (separator) => {
      const skip = toBoolean(one(args[1]))
      return isError(skip) ? skip : joinCapped(flatten(args.slice(2)), separator, skip)
    })
  ),
  LEFT: fn(1, 2, (args) => withText(args[0], (text) => withNumbers([args[1] ?? 1], (count) => (count < 0 ? VALUE : text.slice(0, Math.trunc(count)))))),
  RIGHT: fn(1, 2, (args) =>
    withText(args[0], (text) => withNumbers([args[1] ?? 1], (count) => (count < 0 ? VALUE : text.slice(Math.max(0, text.length - Math.trunc(count))))))
  ),
  MID: fn(3, 3, (args) =>
    withText(args[0], (text) =>
      withNumbers([args[1], args[2]], (start, count) => (start < 1 || count < 0 ? VALUE : text.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(count))))
    )
  ),
  LEN: fn(1, 1, (args) => withText(args[0], (text) => text.length)),
  UPPER: fn(1, 1, (args) => withText(args[0], (text) => text.toUpperCase())),
  LOWER: fn(1, 1, (args) => withText(args[0], (text) => text.toLowerCase())),
  PROPER: fn(1, 1, (args) => withText(args[0], (text) => text.toLowerCase().replace(/(?<!\p{L})\p{L}/gu, (letter) => letter.toUpperCase()))),
  TRIM: fn(1, 1, (args) => withText(args[0], (text) => text.replace(/^ +| +$/g, "").replace(/ {2,}/g, " "))),
  SUBSTITUTE: fn(3, 4, (args) =>
    withText(args[0], (text) =>
      withText(args[1], (old) =>
        withText(args[2], (replacement) =>
          args[3] === undefined ? substitute(text, old, replacement, undefined) : withNumbers([args[3]], (instance) => substitute(text, old, replacement, Math.trunc(instance)))
        )
      )
    )
  ),
  VALUE: fn(1, 1, (args) => {
    const value = one(args[0])
    return typeof value === "boolean" ? VALUE : toNumber(value)
  }),
}
