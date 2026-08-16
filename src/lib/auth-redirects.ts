/**
 * Builds the internal path used to accept an organization invite.
 *
 * @param token - Opaque invite token.
 * @returns Encoded internal invite-acceptance path.
 */
export function buildAcceptInvitePath(token: string): string {
  return `/accept-invite/${encodeURIComponent(token)}`
}

/**
 * Restricts post-authentication redirects to paths within this application.
 *
 * @param nextPath - Untrusted path requested after authentication.
 * @param fallbackPath - Internal path to use when the requested path is unsafe.
 * @returns A safe internal redirect path.
 */
export function getSafeNextPath(
  nextPath: string | null | undefined,
  fallbackPath: string
): string {
  if (!nextPath?.startsWith("/")) {
    return fallbackPath
  }

  try {
    const applicationOrigin = "https://bizflow.invalid"
    const destination = new URL(nextPath, applicationOrigin)

    if (destination.origin !== applicationOrigin) {
      return fallbackPath
    }

    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return fallbackPath
  }
}

/**
 * Builds the absolute Supabase email-confirmation callback URL.
 *
 * @param appUrl - Configured public application URL.
 * @param nextPath - Internal path to open after confirming authentication.
 * @returns Absolute callback URL suitable for Supabase Auth.
 */
export function buildAuthCallbackUrl(appUrl: string, nextPath: string): string {
  const callbackUrl = new URL("/auth/callback", appUrl)
  callbackUrl.searchParams.set("next", getSafeNextPath(nextPath, "/dashboard"))

  return callbackUrl.toString()
}
