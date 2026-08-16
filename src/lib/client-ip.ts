/**
 * Extracts the client IP from platform-set forwarding headers.
 *
 * On Vercel `x-real-ip` is set by the platform and trustworthy; the first
 * `x-forwarded-for` entry is the fallback. Revisit this trust decision if
 * hosting ever moves off Vercel.
 *
 * @param headers - Incoming request headers.
 * @returns The client IP, or `"unknown"` when no forwarding header is set.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim()

  if (realIp) {
    return realIp
  }

  const forwardedFor = headers.get("x-forwarded-for")
  const firstEntry = forwardedFor?.split(",")[0]?.trim()

  return firstEntry && firstEntry.length > 0 ? firstEntry : "unknown"
}
