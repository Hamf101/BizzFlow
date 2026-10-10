import { getErrorStatusCode } from "@/lib/action-result"

/**
 * The message a page may show for a rejected loader.
 *
 * Only a service error refusing the request (status below 500) carries copy
 * written for people; anything else — an SDK, storage, or database failure —
 * can name buckets, keys, or tables, so it gets the fixed fallback.
 *
 * @param error - Value rejected by a page loader.
 * @param fallback - Safe message used for every other rejection.
 * @returns The service's message or the fallback.
 */
export function getPageErrorMessage(
  error: unknown,
  fallback: string
): string {
  const statusCode = getErrorStatusCode(error)

  return error instanceof Error && statusCode !== null && statusCode < 500
    ? error.message
    : fallback
}
