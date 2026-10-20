import * as Sentry from "@sentry/nextjs"

import { getSentryEnv } from "@/lib/env"
import { setCronMonitor } from "@/lib/observability"
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

  // Server only: the browser bundle has no cron monitors.
  setCronMonitor((slug, schedule, job) =>
    Sentry.withMonitor(slug, job, {
      checkinMargin: 10,
      maxRuntime: 15,
      schedule: { type: "crontab", value: schedule },
      timezone: "Etc/UTC",
    })
  )
}
