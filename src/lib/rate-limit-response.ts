import { NextResponse } from "next/server"

import type { RateLimitError } from "@/lib/rate-limit"

/**
 * Converts a rate-limit rejection into a user-safe 429 response.
 *
 * Every API namespace needs the same `Retry-After` handling, so the branch lives
 * here rather than being copied into each `_utils.ts` mapper.
 *
 * @param error - Rejection raised by a rate-limit check.
 * @param logEvent - Structured log event name for the calling API namespace.
 * @param routeName - Stable route identifier included in logs.
 * @returns JSON 429 response carrying the retry hint.
 */
export function createRateLimitResponse(
  error: RateLimitError,
  logEvent: string,
  routeName: string
): Response {
  console.warn(logEvent, {
    reason: error.message,
    routeName,
    statusCode: error.statusCode,
  })
  return NextResponse.json(
    { error: error.message },
    {
      status: error.statusCode,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    }
  )
}
