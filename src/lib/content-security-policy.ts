const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"

export type ContentSecurityPolicyInput = {
  appUrl?: string
  isProduction: boolean
  posthogHost?: string
  posthogKey?: string
  r2Endpoint?: string
}

/**
 * Builds BizFlow's browser Content Security Policy from validated origins.
 *
 * @param input - Runtime mode plus optional application, analytics, and storage URLs.
 * @returns A semicolon-delimited Content Security Policy header value.
 */
export function buildContentSecurityPolicy(
  input: ContentSecurityPolicyInput
): string {
  const connectSources = new Set<string>([
    "'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://*.r2.cloudflarestorage.com",
  ])
  const r2Origin = getHttpOrigin(input.r2Endpoint)

  if (r2Origin) {
    connectSources.add(r2Origin)
  }

  if (input.posthogKey?.trim()) {
    const posthogOrigin = getHttpOrigin(
      input.posthogHost ?? DEFAULT_POSTHOG_HOST
    )

    if (posthogOrigin) {
      connectSources.add(posthogOrigin)
    }
  }

  const usesHttps =
    input.isProduction && getHttpOrigin(input.appUrl)?.startsWith("https://")

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${input.isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(usesHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ")
}

function getHttpOrigin(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null
  } catch {
    return null
  }
}
