type LogValue = string | number | boolean | null | undefined

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

/** Error raised by generated-document fill and signing workflows. */
export class DocumentSigningServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a user-safe signing workflow error.
   *
   * @param message - Safe message for an action or API response.
   * @param statusCode - HTTP-style status code for translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentSigningServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Translates a Supabase or Postgres failure to the stable signing error contract.
 *
 * @param error - Supabase error metadata, or `null` when a response lacked data.
 * @param fallback - Operation-specific safe message for unrecognized failures.
 * @returns HTTP-translatable document-signing error.
 */
export function createDatabaseError(
  error: SupabaseErrorLike | null,
  fallback: string
): DocumentSigningServiceError {
  if (error?.code === "23505") {
    return new DocumentSigningServiceError(
      "A matching signing recipient already exists.",
      409
    )
  }

  if (error?.code === "P0002") {
    return new DocumentSigningServiceError("Signing record was not found.", 404)
  }

  if (
    error?.code === "P0001" &&
    error.message?.toLowerCase().includes("token has expired")
  ) {
    return new DocumentSigningServiceError(
      "This signing link has expired. Ask the sender for a new link.",
      410
    )
  }

  if (error?.code === "23514") {
    return new DocumentSigningServiceError(
      error.message ?? "Signing state changed before it could be saved.",
      409
    )
  }

  if (error?.code === "22023") {
    return new DocumentSigningServiceError(
      error.message ?? "Document signing input is invalid.",
      400
    )
  }

  return new DocumentSigningServiceError(fallback, 500)
}

/**
 * Runs one signing use case with stable error normalization and timing logs.
 *
 * @param operation - Stable operation identifier included in logs.
 * @param context - Non-secret identifiers and counters for observability.
 * @param callback - Signing use case to execute.
 * @returns The use case result.
 * @throws DocumentSigningServiceError when the use case fails.
 */
export async function runSigningOperation<T>(
  operation: string,
  context: Record<string, LogValue>,
  callback: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()

  try {
    const result = await callback()
    console.info("document_signing_operation_succeeded", {
      operation,
      ...context,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return result
  } catch (error: unknown) {
    const normalizedError =
      error instanceof DocumentSigningServiceError
        ? error
        : new DocumentSigningServiceError(
            "Unable to complete the document signing request.",
            500
          )

    console.error("document_signing_operation_failed", {
      operation,
      ...context,
      statusCode: normalizedError.statusCode,
      reason: normalizedError.message,
      durationMs: Math.round(performance.now() - startedAt),
    })
    throw normalizedError
  }
}
