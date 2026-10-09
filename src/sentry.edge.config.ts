import { getSentryEnv } from "@/lib/env"
import { startSentry } from "@/lib/sentry"

const sentryEnv = getSentryEnv()

if (sentryEnv) {
  startSentry({
    dsn: sentryEnv.SENTRY_DSN,
    environment: sentryEnv.SENTRY_ENVIRONMENT,
    tracesSampleRate: sentryEnv.SENTRY_TRACES_SAMPLE_RATE,
  })
}
