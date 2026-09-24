/** PostgreSQL's code for a serialization failure the caller should retry. */
const SERIALIZATION_FAILURE = "40001"

/**
 * Repeats a seeding write the database refused as a concurrent change.
 *
 * Every spec shares one tenant, and each folder or document insert takes the
 * tenant's folder-tree lock without waiting: an insert that meets another
 * spec's answers 40001 and asks to be retried. Seeding does as it asks, a few
 * times, pausing a little longer after each attempt. Any other error, or the
 * last attempt's, is returned for the spec to throw.
 *
 * @param write - Starts the write afresh on each attempt.
 * @param attempts - Most attempts before giving up.
 * @returns The first result that is not a serialization failure, or the last.
 */
export async function retryConcurrentChange<
  TResult extends { error: { code?: string } | null },
>(write: () => PromiseLike<TResult>, attempts = 8): Promise<TResult> {
  let result = await write()

  for (
    let attempt = 1;
    attempt < attempts && result.error?.code === SERIALIZATION_FAILURE;
    attempt += 1
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 150 * attempt))
    result = await write()
  }

  return result
}
