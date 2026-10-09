import * as Sentry from "@sentry/nextjs"

import { startSentry } from "@/lib/sentry"

// The DSN must be read as a literal property access so Next.js can inline it
// into the client bundle; a dynamic lookup would always be undefined there.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (typeof dsn === "string" && dsn.length > 0) {
  startSentry({
    dsn,
    // Literal accesses, inlined at build like the DSN; Vercel exposes its
    // environment to the browser as NEXT_PUBLIC_VERCEL_ENV.
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
      process.env.NEXT_PUBLIC_VERCEL_ENV ||
      "development",
    tracesSampleRate: 0,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
