/** A lowercase RFC 9562 UUID, versions 1 through 8. */
export const LOWERCASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Normalizes an untrusted identifier into a canonical lowercase UUID.
 *
 * @param value - Untrusted identifier.
 * @param reject - Builds the service's own 400 error.
 * @returns The trimmed, lowercase UUID.
 */
export function normalizeUuid(value: unknown, reject: () => Error): string {
  const id = typeof value === "string" ? value.trim().toLowerCase() : ""

  if (!LOWERCASE_UUID_PATTERN.test(id)) {
    throw reject()
  }

  return id
}

/**
 * Trims a name or title, collapses its inner whitespace, and requires its
 * length to fall within a range.
 *
 * @param value - Untrusted text.
 * @param label - Names the value in the message, such as "Folder name".
 * @param min - Fewest characters allowed.
 * @param max - Most characters allowed.
 * @param reject - Builds the service's own 400 error from a user-safe message.
 * @returns The normalized text.
 */
export function normalizeName(
  value: string,
  label: string,
  min: number,
  max: number,
  reject: (message: string) => Error
): string {
  const name = value.trim().replace(/\s+/g, " ")

  if (name.length < min || name.length > max) {
    throw reject(`${label} must be between ${min} and ${max} characters.`)
  }

  return name
}

/**
 * Reads an optional, untrusted row limit.
 *
 * @param value - Untrusted limit, or undefined for the default.
 * @param label - Names the list in the message, such as "Task list".
 * @param fallback - The limit when none is given.
 * @param max - Largest limit allowed.
 * @param reject - Builds the service's own 400 error from a user-safe message.
 * @returns A whole number from 1 to max.
 */
export function normalizeLimit(
  value: number | undefined,
  label: string,
  fallback: number,
  max: number,
  reject: (message: string) => Error
): number {
  if (value === undefined) {
    return fallback
  }

  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw reject(`${label} limit must be between 1 and ${max}.`)
  }

  return value
}
