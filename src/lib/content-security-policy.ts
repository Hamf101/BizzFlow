// Relative: next.config.ts imports this file, outside the "@/" alias.
import { DEFAULT_POSTHOG_HOST } from "./env"

export type ContentSecurityPolicyInput = {
  appUrl?: string
  isProduction: boolean
  posthogHost?: string
  posthogKey?: string
  r2Endpoint?: string
  /** On a deployment build: throw when an origin below is missing, rather than ship a policy that blocks it. */
  requireOrigins?: boolean
  supabaseUrl?: string
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
  const connectSources = new Set<string>(["'self'"])
  // Stored pictures load from the file store, through addresses it signed.
  const imageSources = new Set<string>(["'self'", "data:", "blob:"])
  const r2Origin = getHttpOrigin(input.r2Endpoint)
  const supabaseOrigin = getHttpOrigin(input.supabaseUrl)
  const appOrigin = getHttpOrigin(input.appUrl)

  if (input.requireOrigins) {
    const missing = [
      r2Origin ? null : "CLOUDFLARE_R2_ENDPOINT",
      supabaseOrigin ? null : "SUPABASE_URL",
      // HSTS and upgrade-insecure-requests are only sent for an HTTPS app.
      appOrigin?.startsWith("https://") ? null : "NEXT_PUBLIC_APP_URL (https)",
    ].filter(Boolean)

    if (missing.length > 0) {
      throw new Error(`Security headers need ${missing.join(", ")} at build time.`)
    }
  }

  if (r2Origin) {
    connectSources.add(r2Origin)
    imageSources.add(r2Origin)
  }

  // Editors hear each other through Supabase's live channel, a WebSocket to the same host.
  if (supabaseOrigin) {
    connectSources.add(supabaseOrigin)
    connectSources.add(supabaseOrigin.replace(/^http/, "ws"))
  }

  if (input.posthogKey?.trim()) {
    const posthogOrigin = getHttpOrigin(
      input.posthogHost ?? DEFAULT_POSTHOG_HOST
    )

    if (posthogOrigin) {
      connectSources.add(posthogOrigin)
    }
  }

  const usesHttps = input.isProduction && appOrigin?.startsWith("https://")

  return [
    "default-src 'self'",
    // ponytail: 'unsafe-inline' scripts. Next.js applies a nonce only to
    // dynamically rendered pages, so a nonce would force every page dynamic,
    // static and public pages included, and lose CDN caching. Upgrade path:
    // Next's experimental SRI hashes once stable, or a nonce if every page is
    // dynamic anyway.
    `script-src 'self' 'unsafe-inline'${input.isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${Array.from(imageSources).join(" ")}`,
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
