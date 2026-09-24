const APPLICATION_ORIGIN = "https://bizflow.invalid"
const MAX_DECODE_PASSES = 8

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
  if (!nextPath) {
    return fallbackPath
  }

  const destination = parseSameApplicationPath(nextPath)

  if (!destination) {
    return fallbackPath
  }

  let decodedPath = nextPath

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let nextDecodedPath: string

    try {
      nextDecodedPath = decodeURIComponent(decodedPath)
    } catch {
      return fallbackPath
    }

    if (nextDecodedPath === decodedPath) {
      return serializeRelativePath(destination)
    }

    if (!parseSameApplicationPath(nextDecodedPath)) {
      return fallbackPath
    }

    decodedPath = nextDecodedPath
  }

  // Reject inputs that still change after repeated decoding instead of
  // accepting an ambiguous representation another layer could normalize.
  try {
    if (decodeURIComponent(decodedPath) !== decodedPath) {
      return fallbackPath
    }
  } catch {
    return fallbackPath
  }

  return serializeRelativePath(destination)
}

function parseSameApplicationPath(value: string): URL | null {
  if (
    !hasExactlyOneLeadingSlash(value) ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return null
  }

  try {
    const destination = new URL(value, APPLICATION_ORIGIN)
    const normalizedPath = serializeRelativePath(destination)

    if (
      destination.origin !== APPLICATION_ORIGIN ||
      !hasExactlyOneLeadingSlash(normalizedPath) ||
      normalizedPath.includes("\\") ||
      containsControlCharacter(normalizedPath)
    ) {
      return null
    }

    return destination
  } catch {
    return null
  }
}

function hasExactlyOneLeadingSlash(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//")
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }

  return false
}

function serializeRelativePath(destination: URL): string {
  return `${destination.pathname}${destination.search}${destination.hash}`
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
