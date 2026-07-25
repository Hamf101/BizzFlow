import { withSentryConfig } from "@sentry/nextjs"
import type { NextConfig } from "next"

const isProduction = process.env.NODE_ENV === "production"
const usesHttps =
  isProduction && process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") === true
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(usesHttps ? ["upgrade-insecure-requests"] : []),
].join("; ")

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
  disableLogger: true,
  // Sourcemap upload only runs on builds that hold an auth token (release
  // CI); local and CI check builds stay network-free.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
