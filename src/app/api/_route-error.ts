import { NextResponse } from "next/server"

import { AuthenticationError } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { RequestSecurityError } from "@/lib/request-security"

type ServiceErrorClass = abstract new (
  ...args: never[]
) => Error & { statusCode: number }

/** How one API namespace names its logs and answers what it did not expect. */
export type RouteErrorOptions = Readonly<{
  /** Log prefix: `<event>_rejected` and `<event>_failed`. */
  event: string
  /** Body of the 500 for an unexpected failure. */
  failure: string
  /** Service errors whose own status and user-safe message reach the caller. */
  known: readonly ServiceErrorClass[]
}>

/**
 * Converts a route failure into a user-safe JSON response: 429 with its retry
 * hint, 401 for a signed-out caller, a known error's own status and message,
 * and otherwise a logged, reported 500 that says nothing of the cause.
 *
 * @param error - Unknown caught route failure.
 * @param routeName - Stable route identifier included in logs.
 * @param options - The namespace's log prefix, fallback copy, and known errors.
 * @returns JSON error response with an appropriate HTTP status.
 */
export function createRouteErrorResponse(
  error: unknown,
  routeName: string,
  options: RouteErrorOptions
): Response {
  if (error instanceof RateLimitError) {
    return createRateLimitResponse(error, `${options.event}_rejected`, routeName)
  }

  const statusCode =
    error instanceof AuthenticationError
      ? 401
      : error instanceof RequestSecurityError ||
          options.known.some((known) => error instanceof known)
        ? (error as { statusCode: number }).statusCode
        : null

  if (statusCode !== null && error instanceof Error) {
    console.warn(`${options.event}_rejected`, {
      reason: error.message,
      routeName,
      statusCode,
    })
    return NextResponse.json({ error: error.message }, { status: statusCode })
  }

  console.error(`${options.event}_failed`, {
    reason: error instanceof Error ? error.message : "Unknown route error",
    routeName,
  })
  captureUnexpectedError(error, { routeName })
  return NextResponse.json({ error: options.failure }, { status: 500 })
}
