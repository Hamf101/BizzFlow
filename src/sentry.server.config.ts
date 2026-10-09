import { getSentryEnv } from "@/lib/env"
import { startSentry } from "@/lib/sentry"

const sentryEnv = getSentryEnv()

if (sentryEnv) {
  startSentry({
    dsn: sentryEnv.SENTRY_DSN,
    environment: sentryEnv.SENTRY_ENVIRONMENT,
    tracesSampleRate: sentryEnv.SENTRY_TRACES_SAMPLE_RATE,
    profilesSampleRate: sentryEnv.SENTRY_PROFILES_SAMPLE_RATE,
    // Console logging stays the structured source of truth; forwarding it
    // would duplicate every captured error as noise.
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter(
        (integration) => integration.name !== "Console"
      ),
  })
}
