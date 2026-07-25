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

const SIGNING_TOKEN_PATH_PATTERN = /\/sign\/[^/?#\s]+/g
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
 * Replaces public signing tokens embedded in a URL path with a placeholder.
 *
 * @param value - Text that may contain `/sign/<token>` path segments.
 * @returns The text with every signing token redacted.
 */
export function redactSigningTokens(value: string): string {
  return value.replace(SIGNING_TOKEN_PATH_PATTERN, "/sign/[redacted]")
}

/**
 * Scrubs secrets from an outgoing monitoring event before transport.
 *
 * Drops request bodies entirely and redacts `/sign/<token>` segments from
 * request and breadcrumb URLs — the signing URL path IS the secret, and it
 * must never reach the monitoring backend.
 *
 * @param event - Mutable monitoring event (Sentry `beforeSend` shape).
 * @returns The same event with secrets removed.
 */
export function scrubMonitoringEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    delete event.request.data
    delete event.request.query_string

    if (typeof event.request.url === "string") {
      event.request.url = redactSigningTokens(event.request.url)
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (typeof breadcrumb.message === "string") {
      breadcrumb.message = redactSigningTokens(breadcrumb.message)
    }

    for (const key of BREADCRUMB_URL_KEYS) {
      const value = breadcrumb.data?.[key]

      if (breadcrumb.data && typeof value === "string") {
        breadcrumb.data[key] = redactSigningTokens(value)
      }
    }
  }

  return event
}
