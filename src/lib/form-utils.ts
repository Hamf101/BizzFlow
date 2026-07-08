/**
 * Reads a string field from FormData.
 *
 * @param formData - Submitted form data.
 * @param key - Field name to read.
 * @returns String value or an empty string when absent.
 */
export function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

/**
 * Builds a redirect path with query parameters.
 *
 * @param pathname - Redirect path without query parameters.
 * @param params - Query parameters to append.
 * @returns Path with encoded query string.
 */
export function buildRedirect(pathname: string, params: Record<string, string>): string {
  const searchParams = new URLSearchParams(params)
  return `${pathname}?${searchParams.toString()}`
}
