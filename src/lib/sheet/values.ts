import Big from "big.js"

// The values a sheet computes with, and Excel's rules for turning one kind into
// another. Pure, so the browser and the server work a sheet out alike.

const CODES = ["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#N/A", "#NUM!", "#CIRC!", "#ERROR!"] as const

/** Excel's errors, plus #CIRC! for a cell on a cycle and #ERROR! for a formula that cannot be read. */
export type SheetErrorCode = (typeof CODES)[number]
export type SheetError = { readonly error: SheetErrorCode }
/** An empty cell is null. */
export type CellValue = number | string | boolean | null | SheetError

const ERRORS = Object.fromEntries(CODES.map((code) => [code, Object.freeze({ error: code })])) as Record<SheetErrorCode, SheetError>

export const sheetError = (code: SheetErrorCode): SheetError => ERRORS[code]
export const isSheetErrorCode = (text: string): text is SheetErrorCode => (CODES as readonly string[]).includes(text)

/** A block of cells, read lazily so a large range is never copied. */
export class Area {
  constructor(
    readonly height: number,
    readonly width: number,
    readonly at: (row: number, column: number) => CellValue
  ) {}

  /** Every value, row by row. */
  values(): CellValue[] {
    const out: CellValue[] = []
    for (let row = 0; row < this.height; row += 1) for (let column = 0; column < this.width; column += 1) out.push(this.at(row, column))
    return out
  }
}

/** What a formula part works out to: one value, or a range a function reads. */
export type Result = CellValue | Area

// Structural, so an error that came over the wire as JSON still reads as one.
export const isError = (value: unknown): value is SheetError =>
  typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string"

/** The longest text a cell holds, as in Excel. */
export const MAX_TEXT = 32_767

/** A range where one value belongs: one cell reads as that cell; more is #VALUE! (no spilling). */
export function scalar(value: Result): CellValue {
  if (!(value instanceof Area)) return value
  return value.height === 1 && value.width === 1 ? value.at(0, 0) : ERRORS["#VALUE!"]
}

// --- Numbers -----------------------------------------------------------------

// Decimal arithmetic, so 0.1 + 0.2 is 0.3 and an invoice shows no float noise.
const Decimal = Big()
Decimal.DP = 24
Decimal.RM = Decimal.roundHalfUp

const finite = (value: number): number | SheetError => (Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : ERRORS["#NUM!"])

export const add = (a: number, b: number) => finite(nearZero(Number(new Decimal(a).plus(b)), a, b))
export const subtract = (a: number, b: number) => finite(nearZero(Number(new Decimal(a).minus(b)), a, b))

/** As Excel: a sum or difference within 15 digits of its larger part is rounding left over, so 0. */
function nearZero(result: number, a: number, b: number): number {
  return Math.abs(result) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-15 ? 0 : result
}
export const multiply = (a: number, b: number) => finite(Number(new Decimal(a).times(b)))

export function divide(a: number, b: number): number | SheetError {
  if (b === 0) return ERRORS["#DIV/0!"]
  const quotient = a / b
  // Decimal division keeps 24 places: exact enough for any quotient this size,
  // so a smaller one is left to binary floating point.
  return finite(Math.abs(quotient) >= 1e-6 ? Number(new Decimal(a).div(b)) : quotient)
}

export function power(base: number, exponent: number): number | SheetError {
  if (base === 0 && exponent === 0) return ERRORS["#NUM!"]
  if (base === 0 && exponent < 0) return ERRORS["#DIV/0!"]
  if (Number.isInteger(exponent) && exponent >= 0 && exponent <= 64) return finite(Number(new Decimal(base).pow(exponent)))
  const result = Math.pow(base, exponent)
  return Number.isNaN(result) ? ERRORS["#NUM!"] : finite(result)
}

/** Round half away from zero (ROUND), away from zero (ROUNDUP) or towards it (ROUNDDOWN), on the decimal digits. */
export function roundTo(value: number, places: number, mode: "half" | "up" | "down"): number | SheetError {
  const digits = Math.trunc(places)
  if (Math.abs(digits) > 300) return ERRORS["#NUM!"]
  const rounding = mode === "half" ? Decimal.roundHalfUp : mode === "up" ? Decimal.roundUp : Decimal.roundDown
  return finite(Number(new Decimal(value).round(digits, rounding)))
}

/** The 15 significant digits Excel keeps. */
export const round15 = (value: number): number => (value === 0 ? 0 : Number(value.toPrecision(15)))

/** A number as Excel's General format writes it: 15 significant digits, E-notation at the extremes. */
export function numberText(value: number): string {
  const rounded = round15(value)
  const size = Math.abs(rounded)
  if (size !== 0 && (size >= 1e15 || size < 1e-9)) {
    const [mantissa, exponent] = rounded.toExponential().split("e") as [string, string]
    return `${mantissa}E${exponent.startsWith("-") ? "-" : "+"}${exponent.replace(/^[+-]/, "").padStart(2, "0")}`
  }
  return new Decimal(rounded).toFixed()
}

const NUMBER_TEXT = /^([+-]?)\s*\$?((?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d*)?)(?:e([+-]?\d+))?\s*(%?)$/i
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/

/** Text Excel reads as a number: "1,000", "$12.50", "50%", "1e3", "2024-01-15"; anything else is null. */
export function parseNumberText(text: string): number | null {
  const trimmed = text.trim()
  const date = ISO_DATE.exec(trimmed)
  if (date) {
    const serial = dateSerial(Number(date[1]), Number(date[2]), Number(date[3]))
    return typeof serial === "number" && Number(date[2]) <= 12 && Number(date[3]) <= 31 ? serial : null
  }
  const match = NUMBER_TEXT.exec(trimmed)
  if (!match || !/\d/.test(match[2]!)) return null
  const value = Number(`${match[1]}${match[2]!.replaceAll(",", "")}e${match[3] ?? 0}`)
  if (!Number.isFinite(value)) return null
  return match[4] ? Number(new Decimal(value).div(100)) : value
}

// --- Coercion ----------------------------------------------------------------

/** A value used as a number: an empty cell is 0, TRUE is 1, text must read as a number. */
export function toNumber(value: CellValue): number | SheetError {
  if (typeof value === "number") return value
  if (value === null) return 0
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "string") return parseNumberText(value) ?? ERRORS["#VALUE!"]
  return value
}

/** A value used as text: an empty cell is "". */
export function toText(value: CellValue): string | SheetError {
  if (typeof value === "string") return value
  if (value === null) return ""
  if (typeof value === "number") return numberText(value)
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  return value
}

/** A value used as TRUE/FALSE: numbers are TRUE unless 0, text must say TRUE or FALSE. */
export function toBoolean(value: CellValue): boolean | SheetError {
  if (typeof value === "boolean") return value
  if (value === null) return false
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const upper = value.toUpperCase()
    return upper === "TRUE" ? true : upper === "FALSE" ? false : ERRORS["#VALUE!"]
  }
  return value
}

const RANK = { number: 0, string: 1, boolean: 2 } as const

/**
 * Orders two values as Excel's comparison operators do: numbers before text
 * before TRUE/FALSE, text without regard to case, an empty cell as the other
 * side's blank (0, "" or FALSE). Numbers compare at 15 significant digits.
 */
export function compareValues(left: Exclude<CellValue, SheetError>, right: Exclude<CellValue, SheetError>): number {
  const a = left ?? blankLike(right)
  const b = right ?? blankLike(left)
  const kindA = RANK[typeof a as keyof typeof RANK]
  const kindB = RANK[typeof b as keyof typeof RANK]
  if (kindA !== kindB) return kindA - kindB
  if (typeof a === "number") return compareNumbers(a, b as number)
  if (typeof a === "string") return compareText(a, b as string)
  return Number(a) - Number(b)
}

/** Numbers in order at Excel's 15 significant digits, so 0.1+0.2 equals 0.3. */
export function compareNumbers(a: number, b: number): number {
  if (a === b) return 0
  // Numbers further apart than this cannot meet at 15 digits; skip the rounding.
  if (Math.abs(a - b) > (Math.abs(a) + Math.abs(b)) * 1e-14) return a < b ? -1 : 1
  return Math.sign(round15(a) - round15(b))
}

const blankLike = (other: CellValue) => (typeof other === "string" ? "" : typeof other === "boolean" ? false : 0)

// Code-point order on lower case: the same in every browser and on the server,
// unlike localeCompare.
export function compareText(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// --- Dates (1900 date system) ------------------------------------------------

const DAY = 86_400_000
const EPOCH = Date.UTC(1899, 11, 31)
/** 9999-12-31, the last date Excel knows. */
const LAST_SERIAL = 2_958_465

/**
 * The serial Excel gives a date, months and days rolling over as DATE does.
 * Excel counts 29 Feb 1900, a day that never was, as serial 60; dates from
 * 1 Mar 1900 on are one higher than a true count, which is kept so serials
 * match real Excel files.
 */
export function dateSerial(year: number, month: number, day: number): number | SheetError {
  const fullYear = year < 1900 ? year + 1900 : year
  if (year < 0 || fullYear > 9999) return ERRORS["#NUM!"]
  const first = new Date(Date.UTC(2000, 0, 1))
  first.setUTCFullYear(fullYear, month - 1, 1)
  const firstSerial = Math.round((first.getTime() - EPOCH) / DAY)
  const serial = firstSerial + (first.getTime() >= Date.UTC(1900, 2, 1) ? 1 : 0) + Math.trunc(day) - 1
  return !Number.isFinite(serial) || serial < 0 || serial > LAST_SERIAL ? ERRORS["#NUM!"] : serial
}

/** The calendar date of a serial, Excel's way: serial 0 is 0 Jan 1900, serial 60 is 29 Feb 1900. */
export function serialDate(serial: number): { year: number; month: number; day: number } | SheetError {
  const whole = Math.floor(serial)
  if (whole < 0 || whole > LAST_SERIAL) return ERRORS["#NUM!"]
  if (whole === 0) return { year: 1900, month: 1, day: 0 }
  if (whole === 60) return { year: 1900, month: 2, day: 29 }
  const date = new Date(EPOCH + (whole < 60 ? whole : whole - 1) * DAY)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}
