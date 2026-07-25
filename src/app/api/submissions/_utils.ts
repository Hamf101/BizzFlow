import { NextResponse } from "next/server"

import { AuthenticationError } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { RateLimitError } from "@/lib/rate-limit"
import { RequestSecurityError } from "@/lib/request-security"
import { SubmissionStorageServiceError } from "@/services/submission-storage-service"
import { SubmissionServiceError } from "@/services/submission-service"

/**
 * Reads a required trimmed string from a trusted JSON object.
 *
 * @param body - Parsed request body.
 * @param key - Property to read.
 * @param label - User-safe field label.
 * @returns Non-empty trimmed string.
 * @throws SubmissionServiceError when the value is missing or blank.
 */
export function getRequiredSubmissionString(
  body: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = body[key]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SubmissionServiceError(`${label} is required.`, 400)
  }

  return value.trim()
}

/**
 * Reads a required positive integer from a trusted JSON object.
 *
 * @param body - Parsed request body.
 * @param key - Property to read.
 * @param label - User-safe field label.
 * @returns Positive integer value.
 * @throws SubmissionServiceError when the value is absent or invalid.
 */
export function getRequiredSubmissionInteger(
  body: Record<string, unknown>,
  key: string,
  label: string
): number {
  const value = body[key]

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SubmissionServiceError(`${label} must be a positive integer.`, 400)
  }

  return value
}

/**
 * Converts typed submission route failures into user-safe JSON responses.
 *
 * @param error - Unknown caught route failure.
 * @param routeName - Stable route identifier included in logs.
 * @returns JSON error response with an appropriate HTTP status.
 */
export function createSubmissionRouteErrorResponse(
  error: unknown,
  routeName: string
): Response {
  if (error instanceof AuthenticationError) {
    return logSubmissionRouteRejection(error.message, 401, routeName)
  }

  if (error instanceof RateLimitError) {
    console.warn("submission_route_rejected", {
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

  if (
    error instanceof RequestSecurityError ||
    error instanceof SubmissionServiceError ||
    error instanceof SubmissionStorageServiceError
  ) {
    return logSubmissionRouteRejection(
      error.message,
      error.statusCode,
      routeName
    )
  }

  console.error("submission_route_failed", {
    reason: error instanceof Error ? error.message : "Unknown route error",
    routeName,
  })
  captureUnexpectedError(error, { routeName })
  return NextResponse.json(
    { error: "Submission request failed." },
    { status: 500 }
  )
}

function logSubmissionRouteRejection(
  message: string,
  statusCode: number,
  routeName: string
): Response {
  console.warn("submission_route_rejected", {
    reason: message,
    routeName,
    statusCode,
  })
  return NextResponse.json({ error: message }, { status: statusCode })
}
