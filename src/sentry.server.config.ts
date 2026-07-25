import * as Sentry from "@sentry/nextjs"

import { getSentryEnv } from "@/lib/env"
import { scrubMonitoringEvent, setErrorReporter } from "@/lib/observability"

const sentryEnv = getSentryEnv()

if (sentryEnv) {
  Sentry.init({
    dsn: sentryEnv.SENTRY_DSN,
    environment: sentryEnv.SENTRY_ENVIRONMENT,
    tracesSampleRate: sentryEnv.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: sentryEnv.SENTRY_PROFILES_SAMPLE_RATE,
    sendDefaultPii: false,
    // Console logging stays the structured source of truth; forwarding it
    // would duplicate every captured error as noise.
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter(
        (integration) => integration.name !== "Console"
      ),
    beforeSend: (event) => scrubMonitoringEvent(event),
  })

  setErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context })
  })
}
