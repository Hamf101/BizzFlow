import { getClientIp } from "@/lib/client-ip"
import {
  checkRateLimit as defaultCheck,
  RateLimitError,
  type CheckRateLimit,
} from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"

type Deps = { check?: CheckRateLimit }

// The editor's live sync and its token renewal already spend per-member budgets
// sized for typing; the job host calls /api/inngest from a few shared addresses.
function hasOwnLimits(pathname: string): boolean {
  return (
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/api/working-copies/") ||
    (pathname.startsWith("/api/") && /\/room(\/|$)/.test(pathname))
  )
}

/**
 * Spends the caller's per-address budget before anything else touches the
 * request, so a flood from one address is refused before it costs a session
 * lookup or a render. The endpoint-specific buckets sit below this.
 *
 * @param request - The incoming request.
 * @param deps - Optional limit check, for tests.
 * @returns A 429 response when over budget, otherwise `null`.
 */
export async function limitRequestByIp(request: Request, deps: Deps = {}): Promise<Response | null> {
  const { pathname } = new URL(request.url)

  if (hasOwnLimits(pathname)) {
    return null
  }

  return spend(request, deps.check ?? defaultCheck, "request_ip", getClientIp(request.headers))
}

/**
 * Spends a signed-in member's budget for what has no bucket of its own: every
 * API call, and every server action (a POST to a page). Rendering a page is
 * not counted. Exports get a smaller budget because each reads a whole list.
 *
 * @param request - The incoming request.
 * @param userId - The verified member.
 * @param deps - Optional limit check, for tests.
 * @returns A 429 response when over budget, otherwise `null`.
 */
export async function limitRequestByMember(
  request: Request,
  userId: string,
  deps: Deps = {}
): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  const readsAPage = !pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")

  if (readsAPage || hasOwnLimits(pathname)) {
    return null
  }

  const bucket = pathname.startsWith("/api/export/") ? "member_export" : "member_request"

  return spend(request, deps.check ?? defaultCheck, bucket, userId)
}

async function spend(
  request: Request,
  check: CheckRateLimit,
  bucket: "request_ip" | "member_request" | "member_export",
  key: string
): Promise<Response | null> {
  try {
    await check(bucket, key)
    return null
  } catch (error: unknown) {
    if (!(error instanceof RateLimitError)) {
      throw error
    }

    return createRateLimitResponse(error, "request_rate_limited", new URL(request.url).pathname)
  }
}
