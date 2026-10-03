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
