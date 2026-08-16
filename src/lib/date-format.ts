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
