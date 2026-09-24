/** PostgREST's code for a counted range that starts past the last row. */
const RANGE_NOT_SATISFIABLE = "PGRST103"

/**
 * Rows asked for per export batch. PostgREST answers with at most 1,000
 * (`max_rows` in supabase/config.toml, and the hosted default).
 */
export const POSTGREST_BATCH_SIZE = 1_000

/** A counted, ranged read as PostgREST answers it. */
export type CountedPageResponse<TRow> = {
  count: number | null
  data: TRow[] | null
  error: { code?: string } | null
}

/** One batch of rows as PostgREST answers it. */
export type BatchResponse<TRow> = {
  data: TRow[] | null
  error: unknown
}

/**
 * Reads one counted page of rows.
 *
 * PostgREST refuses a counted range that starts past the last matching row
 * (416, PGRST103) instead of answering with an empty page. That case counts on
 * its own, so a stale link can still be sent to the last page.
 *
 * @param response - The awaited counted, ranged query.
 * @param countAll - Counts every row the same filters match.
 * @param fail - Builds the caller's own error for any other failure.
 * @returns The page's rows (none past the end) and the matching total.
 */
export async function readCountedPage<TRow>(
  response: CountedPageResponse<TRow>,
  countAll: () => Promise<number>,
  fail: (error: unknown) => Error
): Promise<{ rows: TRow[]; total: number }> {
  if (response.error?.code === RANGE_NOT_SATISFIABLE) {
    return { rows: [], total: await countAll() }
  }

  if (response.error || !response.data) {
    throw fail(response.error)
  }

  return { rows: response.data, total: response.count ?? 0 }
}

/**
 * Reads every row a query matches, one keyset batch after another, for a
 * complete export.
 *
 * Only an empty batch proves the end: a deployment may cap responses below the
 * requested batch (`max_rows`), so a short batch alone does not mean nothing
 * follows. More rows than the limit are refused, never truncated.
 *
 * @param readBatch - Reads the batch after the previous row (none at first).
 * @param limits - The caller's errors and the most rows it will take.
 * @returns Every matching row, in batch order.
 */
export async function readAllInBatches<TRow>(
  readBatch: (previous: TRow | undefined) => PromiseLike<BatchResponse<TRow>>,
  limits: {
    fail: (error: unknown) => Error
    maxRows: number
    tooMany: () => Error
  }
): Promise<TRow[]> {
  const rows: TRow[] = []

  for (;;) {
    const { data, error } = await readBatch(rows.at(-1))

    if (error || !data) {
      throw limits.fail(error)
    }

    if (data.length === 0) {
      return rows
    }

    if (rows.length + data.length > limits.maxRows) {
      throw limits.tooMany()
    }

    rows.push(...data)
  }
}

/**
 * Makes a search literal inside an ILIKE pattern.
 *
 * `%`, `_`, and the backslash would otherwise act as ILIKE syntax. PostgREST
 * also reads `*` as `%`, so an asterisk in a search can only widen it.
 *
 * @param value - Untrusted search text.
 * @returns The text with ILIKE syntax escaped.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&")
}
