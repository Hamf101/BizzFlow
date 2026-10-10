/** The fields a Supabase (PostgREST or Postgres) error may carry. */
export type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

/**
 * Reads an unknown failure as a Supabase error.
 *
 * @param error - Whatever a query returned or threw.
 * @returns The error's fields, or null when it is not an object.
 */
export function asSupabaseError(error: unknown): SupabaseErrorLike | null {
  return error && typeof error === "object" ? (error as SupabaseErrorLike) : null
}

/**
 * Joins an error's message, details and hint, lower-cased, for phrase checks.
 *
 * @param error - The Supabase error, or null.
 * @returns The searchable text; empty when there is none.
 */
export function searchableErrorText(error: SupabaseErrorLike | null): string {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase()
}
