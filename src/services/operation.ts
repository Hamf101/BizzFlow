import { captureUnexpectedError } from "@/lib/observability"

/** A value safe to log beside an operation: an id, a count, a flag. */
export type LogValue = string | number | boolean | null | undefined

/** What a service throws: a message fit to show, and the status it means. */
type ServiceFailure = Error & { statusCode: number }

// A page view runs a dozen reads, and their successes were most of the log
// volume. Every slow one is still logged, with one in ten of the rest.
const SLOW_MS = 1_000
const SUCCESS_SAMPLE_RATE = 0.1

/**
 * Runs one service operation: times it, logs it, and hands the caller only an
 * error it may show. A refusal is logged as rejected. A failure, anything at
 * 500 or above, is logged with its real reason and reported.
 *
 * @param domain - Names the log events: `task` logs `task_service_failed`.
 * @param translate - Turns anything thrown into the domain's own error.
 * @param operationName - Stable operation identifier for logs.
 * @param identifiers - Ids and flags logged with the operation; never content.
 * @param operation - The work.
 * @returns The operation's result.
 * @throws The domain's error, from translate.
 */
export async function runOperation<T>(
  domain: string,
  translate: (error: unknown) => ServiceFailure,
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    const durationMs = Date.now() - startedAt

    if (durationMs >= SLOW_MS || Math.random() < SUCCESS_SAMPLE_RATE) {
      console.info(`${domain}_service_success`, { operationName, durationMs, ...identifiers })
    }

    return result
  } catch (error: unknown) {
    const failure = translate(error)
    const context = { operationName, durationMs: Date.now() - startedAt, statusCode: failure.statusCode, ...identifiers }

    if (failure.statusCode < 500) {
      console.warn(`${domain}_service_rejected`, { ...context, reason: failure.message })
    } else {
      console.error(`${domain}_service_failed`, { ...context, reason: error instanceof Error ? error.message : failure.message })
      captureUnexpectedError(error, { operationName, ...identifiers })
    }

    throw failure
  }
}
