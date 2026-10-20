export type ErrorReportContext = Record<
  string,
  string | number | boolean | null | undefined
>

/** Function that forwards an unexpected error to the monitoring backend. */
export type ErrorReporter = (
  error: unknown,
  context: ErrorReportContext
) => void

type ScrubbableRequest = {
  url?: string
  query_string?: unknown
  data?: unknown
}

type ScrubbableBreadcrumb = {
  message?: string
  data?: Record<string, unknown>
}

export type ScrubbableEvent = {
  request?: ScrubbableRequest
  breadcrumbs?: ScrubbableBreadcrumb[]
}

// Each public link carries its bearer token as the path segment after one of these.
const TOKEN_PATH_PATTERN = /\/(sign|forms|shared|accept-invite|api\/public-forms)\/[^/?#\s]+/g
const BREADCRUMB_URL_KEYS = ["url", "to", "from"] as const

let activeReporter: ErrorReporter | null = null

/**
 * Log fields that say why an operation failed: the error's name and message,
 * and the database code and message of the error it wraps (`cause`).
 *
 * For server logs only — the messages can name tables or constraints, so
 * they must never reach a response.
 *
 * @param error - Caught error, possibly wrapping a database error.
 * @returns Name, message, code, and the wrapped error's message.
 */
export function describeErrorForLog(
  error: unknown
): Record<string, string | null> {
  const cause = error instanceof Error ? error.cause : undefined

  return {
    errorName: error instanceof Error ? error.name : null,
    reason: readStringField(error, "message"),
    code: readStringField(cause, "code") ?? readStringField(error, "code"),
    causeMessage: readStringField(cause, "message"),
  }
}

function readStringField(value: unknown, key: "code" | "message"): string | null {
  const field =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined

  return typeof field === "string" ? field : null
}

/**
 * Registers the process-wide error reporter, or clears it with `null`.
 *
 * Called once from Sentry instrumentation at boot; tests inject fakes. While
 * no reporter is registered every capture call is a no-op, so local dev and
 * CI run without any monitoring configuration.
 *
 * @param reporter - Reporter invoked for each unexpected error, or `null`.
 */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  activeReporter = reporter
}

/** Runs a scheduled job inside a check-in, as Sentry's cron monitors do. */
export type CronMonitor = <T>(slug: string, schedule: string, job: () => Promise<T>) => Promise<T>

let activeCronMonitor: CronMonitor | null = null

/**
 * Registers the process-wide cron monitor, or clears it with `null`; called
 * once from Sentry instrumentation at boot.
 *
 * @param monitor - Monitor wrapping each scheduled run, or `null`.
 */
export function setCronMonitor(monitor: CronMonitor | null): void {
  activeCronMonitor = monitor
}

/**
 * Runs a scheduled job with a heartbeat, so a job that stops running, runs
 * late or keeps failing raises an alert instead of going unnoticed. Without a
 * monitor (local dev, CI, tests) it just runs the job.
 *
 * @param slug - The monitor's stable name.
 * @param schedule - The job's crontab, in UTC.
 * @param job - The run itself.
 * @returns What the run returns; its error, unchanged.
 */
export function monitorCron<T>(slug: string, schedule: string, job: () => Promise<T>): Promise<T> {
  return activeCronMonitor ? activeCronMonitor(slug, schedule, job) : job()
}

/**
 * Forwards an unexpected error to the registered reporter, if any.
 *
 * Never throws: monitoring must not break the request path. Context values
 * must be safe identifiers (operation names, entity ids) — never tokens,
 * file bytes, or PII.
 *
 * @param error - The original unexpected error.
 * @param context - Safe identifiers describing where the error occurred.
 */
export function captureUnexpectedError(
  error: unknown,
  context: ErrorReportContext
): void {
  if (!activeReporter) {
    return
  }

  try {
    activeReporter(error, context)
  } catch {
    // Reporting failures are intentionally swallowed.
  }
}

/**
 * Replaces the bearer tokens public links carry in their path with a
 * placeholder: signing, answering, guest-sharing and invite links.
 *
 * @param value - Text that may contain such path segments.
 * @returns The text with every link token redacted.
 */
export function redactUrlTokens(value: string): string {
  return value.replace(TOKEN_PATH_PATTERN, "/$1/[redacted]")
}

/**
 * Scrubs secrets from an outgoing monitoring event before transport.
 *
 * Drops request bodies entirely and redacts link tokens from request and
 * breadcrumb URLs — a public link's path IS the secret, and it must never
 * reach the monitoring backend.
 *
 * @param event - Mutable monitoring event (Sentry `beforeSend` shape).
 * @returns The same event with secrets removed.
 */
export function scrubMonitoringEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data
    delete event.request.query_string

    if (typeof event.request.url === "string") {
      event.request.url = redactUrlTokens(event.request.url)
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (typeof breadcrumb.message === "string") {
      breadcrumb.message = redactUrlTokens(breadcrumb.message)
    }

    for (const key of BREADCRUMB_URL_KEYS) {
      const value = breadcrumb.data?.[key]

      if (breadcrumb.data && typeof value === "string") {
        breadcrumb.data[key] = redactUrlTokens(value)
      }
    }
  }

  return event
}
