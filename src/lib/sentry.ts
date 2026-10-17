import * as Sentry from "@sentry/nextjs"

import { scrubMonitoringEvent, setCronMonitor, setErrorReporter } from "@/lib/observability"

/**
 * Starts Sentry for one runtime with the scrubbing every runtime shares, and
 * routes `captureUnexpectedError` to it.
 *
 * @param options - The runtime's DSN, environment, and sampling; the shared
 *   privacy options below always win.
 */
export function startSentry(options: Parameters<typeof Sentry.init>[0]): void {
  Sentry.init({
    ...options,
    sendDefaultPii: false,
    beforeSend: (event) => scrubMonitoringEvent(event),
    beforeSendTransaction: (event) => scrubMonitoringEvent(event),
  })

  setErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context })
  })

  setCronMonitor((slug, schedule, job) =>
    Sentry.withMonitor(slug, job, {
      checkinMargin: 10,
      maxRuntime: 15,
      schedule: { type: "crontab", value: schedule },
      timezone: "Etc/UTC",
    })
  )
}
