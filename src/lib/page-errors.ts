/**
 * Preserves an Error message under the existing page contract or uses a fallback.
 *
 * @param error - Value rejected by a page loader.
 * @param fallback - Safe message used when the rejection is not an Error.
 * @returns The existing error message or supplied fallback.
 */
export function getPageErrorMessage(
  error: unknown,
  fallback: string
): string {
  return error instanceof Error ? error.message : fallback
}
