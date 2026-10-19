import type { SaveResult } from "@/components/editor/use-autosave"
import { getErrorStatusCode } from "@/lib/action-result"
import { AuthenticationError } from "@/lib/auth"

/**
 * Turns an editor save's failure into what its save status shows: sign in
 * again, the service's own refusal (a 409 stops saving), or a logged 500 that
 * says nothing of the cause.
 *
 * @param error - What the save threw.
 * @param eventName - The log event.
 * @param documentId - The document, for the log.
 * @returns The failed save.
 */
export function toSaveFailure(error: unknown, eventName: string, documentId: string): SaveResult {
  if (error instanceof AuthenticationError) {
    return { message: "Sign in again to keep saving.", ok: false, status: 401 }
  }

  const statusCode = getErrorStatusCode(error) ?? 500

  console.warn(eventName, {
    documentId,
    reason: error instanceof Error ? error.message : "Unknown document save error",
  })

  return {
    message: statusCode === 500 ? "The document could not be saved." : (error as Error).message,
    ok: false,
    status: statusCode,
  }
}
