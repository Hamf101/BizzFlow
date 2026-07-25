import * as Sentry from "@sentry/nextjs"

import { getSentryEnv } from "@/lib/env"
import { scrubMonitoringEvent, setErrorReporter } from "@/lib/observability"

const sentryEnv = getSentryEnv()

if (sentryEnv) {
  Sentry.init({
    dsn: sentryEnv.SENTRY_DSN,
    environment: sentryEnv.SENTRY_ENVIRONMENT,
    tracesSampleRate: sentryEnv.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeSend: (event) => scrubMonitoringEvent(event),
  })

  setErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context })
  })
}
