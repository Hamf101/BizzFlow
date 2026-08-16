import * as Sentry from "@sentry/nextjs"

import { scrubMonitoringEvent, setErrorReporter } from "@/lib/observability"

// The DSN must be read as a literal property access so Next.js can inline it
// into the client bundle; a dynamic lookup would always be undefined there.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (typeof dsn === "string" && dsn.length > 0) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: (event) => scrubMonitoringEvent(event),
  })

  setErrorReporter((error, context) => {
    Sentry.captureException(error, { extra: context })
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
