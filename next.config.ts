import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

import { buildContentSecurityPolicy } from "./src/lib/content-security-policy"

const isProduction = process.env.NODE_ENV === "production"
const usesHttps =
  isProduction && process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") === true

// Sentry needs no connect-src entry because browser events tunnel through the
// same-origin /monitoring route. Browser uploads do need the configured R2
// origin, including the local MinIO origin used by the end-to-end suite.
const contentSecurityPolicy = buildContentSecurityPolicy({
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  isProduction,
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  r2Endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
})

const securityHeaders: Array<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
  ...(usesHttps
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Embedded logos/images are validated and capped by the template schema.
    serverActions: { bodySizeLimit: "10mb" },
    // Every dashboard route is dynamic, and Next's default `dynamic: 0` means
    // the client router re-fetches from the server on every visit — including
    // going straight back to a page opened seconds ago. Mutations already call
    // revalidatePath, so a short reuse window is safe and makes repeat
    // navigation instant.
    staleTimes: { dynamic: 30, static: 300 },
    // Prefetch the real page payload on hover/touch rather than only the
    // loading skeleton, so the data is usually resolved before the click lands.
    dynamicOnHover: true,
  },
  // Ensure serverless/standalone builds carry the PDF renderer's font files.
  outputFileTracingIncludes: {
    "/api/documents/*/pdf": [
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
      "./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  // Browser events post to same-origin /monitoring, so the strict CSP
  // connect-src above needs no Sentry ingest origin.
  tunnelRoute: "/monitoring",
  // Replaces the deprecated `disableLogger`. Sentry warns that the webpack
  // treeshake option is not honoured under Turbopack, so debug logging is only
  // stripped from webpack builds.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Sourcemap upload only runs on builds that hold an auth token (release
  // CI); local and CI check builds stay network-free.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
