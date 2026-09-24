/**
 * Formats an ISO date value using the application's medium English date style.
 *
 * @param value - Date-compatible string value.
 * @returns Localized medium-length date text.
 */
export function formatMediumDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value))
}

/**
 * Formats an ISO date-time value using the application's shared display style.
 *
 * @param value - Date-compatible string value.
 * @returns Localized medium date and short time text.
 */
export function formatMediumDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

/**
 * Writes a day the way date answers are stored, YYYY-MM-DD, in the viewer's
 * own time zone, so the day someone sees is the day that is kept.
 *
 * @param date - The day.
 * @returns The stored form of that day.
 */
export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`
}

/** Which part of a date comes first: day, month or year. */
export const DATE_ORDERS = ["dmy", "mdy", "ymd"] as const
/** What sits between a date's numbers; a written month uses spaces instead. */
export const DATE_SEPARATORS = ["/", ".", "-", " "] as const
/** The month as a number, a short name, or in full. */
export const DATE_MONTH_STYLES = ["number", "short", "long"] as const

/** A date field's format; answers themselves are always stored as YYYY-MM-DD. */
export type DateFormat = {
  month: (typeof DATE_MONTH_STYLES)[number]
  order: (typeof DATE_ORDERS)[number]
  separator: (typeof DATE_SEPARATORS)[number]
}

/** Month names in English, January first. */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/**
 * Writes a stored YYYY-MM-DD answer the way its field asks. A field saved
 * before formats existed prints the stored value, as it always has, and
 * anything that is not a stored date comes back unchanged. The date is read
 * as text, never through a clock, so no time zone can move the day.
 *
 * @param value - The stored answer.
 * @param format - The field's format, if it has one.
 * @returns The date as the page should show it.
 */
export function formatDateAnswer(value: string, format: DateFormat | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match || !format) {
    return value
  }

  const [, year = "", month = "", day = ""] = match

  if (format.month === "number") {
    const parts = { d: day, m: month, y: year }
    return [...format.order].map((part) => parts[part as keyof typeof parts]).join(format.separator)
  }

  const fullName = MONTH_NAMES[Number(month) - 1] ?? month
  const name = format.month === "long" ? fullName : fullName.slice(0, 3)
  const date = String(Number(day))

  return format.order === "dmy"
    ? `${date} ${name} ${year}`
    : format.order === "mdy"
      ? `${name} ${date}, ${year}`
      : `${year} ${name} ${date}`
}

/**
 * What an empty date field shows: the shape its dates will take.
 *
 * @param format - The field's format, if it has one.
 * @returns A hint such as "dd/mm/yyyy" or "d month yyyy".
 */
export function describeDateFormat(format: DateFormat | undefined): string {
  if (!format) {
    return "yyyy-mm-dd"
  }

  if (format.month === "number") {
    const parts = { d: "dd", m: "mm", y: "yyyy" }
    return [...format.order].map((part) => parts[part as keyof typeof parts]).join(format.separator)
  }

  const name = format.month === "long" ? "month" : "mon"
  return format.order === "dmy" ? `d ${name} yyyy` : format.order === "mdy" ? `${name} d, yyyy` : `yyyy ${name} d`
}
