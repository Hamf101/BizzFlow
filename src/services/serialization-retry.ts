/** PostgreSQL's code for a serialization failure the caller should retry. */
const SERIALIZATION_FAILURE = "40001"

/** Attempts before a collision is reported rather than retried. */
const MAX_ATTEMPTS = 4

/** What a member sees when a write keeps meeting concurrent changes. */
export const CONCURRENT_CHANGE_MESSAGE =
  "Another change was saving at the same moment. Try again."

/**
 * Reports whether a database error asks to be retried.
 *
 * @param error - A database error, or anything else.
 * @returns True for a serialization failure (40001).
 */
export function isSerializationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === SERIALIZATION_FAILURE
  )
}

/**
 * Runs a write again when the database answers that it met a concurrent
 * change and asks to be retried (40001).
 *
 * Every folder and document insert takes its organization's folder-tree lock
 * without waiting, so without this two members creating things at the same
 * instant would see the second one fail. A short, growing pause lets the
 * other write finish; after the last attempt its error is returned for the
 * caller to report.
 *
 * @param write - Starts the write afresh on each attempt.
 * @param pause - Waits before the next attempt; tests pass their own.
 * @returns The first result that is not a serialization failure, or the last.
 */
export async function retrySerializationFailure<TResult extends { error: unknown }>(
  write: () => PromiseLike<TResult>,
  pause: (attempt: number) => Promise<void> = waitBeforeRetry
): Promise<TResult> {
  let result = await write()

  for (
    let attempt = 1;
    attempt < MAX_ATTEMPTS && isSerializationFailure(result.error);
    attempt += 1
  ) {
    await pause(attempt)
    result = await write()
  }

  return result
}

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 25 * attempt)
  })
}
