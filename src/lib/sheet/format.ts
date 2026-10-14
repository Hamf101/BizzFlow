import { isError, numberText, serialDate, type CellValue } from "@/lib/sheet/values"
import type { SheetFormat } from "@/types/sheet"

// How a cell's value reads on screen, in the viewer's locale. Display only:
// the value itself is never changed.

export type DisplayOptions = { locale: string; /** The organisation's currency, for money cells that name none. */ currency: string }

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: unknown[], make: () => T): T {
  const id = JSON.stringify(key)
  let formatter = formatters.get(id)
  if (!formatter) formatters.set(id, (formatter = make()))
  return formatter as T
}

const numberFormat = (locale: string, options: Intl.NumberFormatOptions) => cached(["n", locale, options], () => new Intl.NumberFormat(locale, options))

const places = (decimals: number | undefined, fallback: number) => {
  const digits = decimals ?? fallback
  return { minimumFractionDigits: digits, maximumFractionDigits: digits }
}

/**
 * A cell's value as text for the grid.
 *
 * @param value - The worked-out value.
 * @param format - The cell's display format; General when absent.
 * @param options - The viewer's locale and the organisation's currency.
 * @returns The text to show.
 */
export function formatCellValue(value: CellValue, format: SheetFormat | undefined, options: DisplayOptions): string {
  if (value === null) return ""
  if (isError(value)) return value.error
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "string") return value

  const { locale } = options
  switch (format?.type) {
    case "number":
      return numberFormat(locale, places(format.decimals, 2)).format(value)
    case "money":
      return numberFormat(locale, { style: "currency", currencyDisplay: "narrowSymbol", currency: format.currency ?? options.currency, ...(format.decimals === undefined ? {} : places(format.decimals, 2)) }).format(value)
    case "percent":
      return numberFormat(locale, { style: "percent", ...places(format.decimals, 0) }).format(value)
    case "date":
      return formatDate(value, locale) ?? general(value, locale)
    case "text":
      return numberText(value)
    default:
      return general(value, locale)
  }
}

// Excel's General: up to 15 significant digits, no grouping, E-notation at the extremes.
function general(value: number, locale: string): string {
  const plain = numberText(value)
  return plain.includes("E") ? plain : numberFormat(locale, { useGrouping: false, maximumSignificantDigits: 15 }).format(value)
}

function formatDate(serial: number, locale: string): string | null {
  const date = serialDate(serial)
  if (isError(date) || date.day === 0) return null
  const formatter = cached(["d", locale], () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }))
  // Excel's 29 Feb 1900 (serial 60) never existed, so Intl cannot write it: write 28 Feb and change the day.
  const leapBug = date.year === 1900 && date.month === 2 && date.day === 29
  const parts = formatter.formatToParts(new Date(Date.UTC(date.year, date.month - 1, leapBug ? 28 : date.day)))
  return parts.map((part) => (leapBug && part.type === "day" ? part.value.replace("28", "29") : part.value)).join("")
}
