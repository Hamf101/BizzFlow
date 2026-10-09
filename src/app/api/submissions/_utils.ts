import { createRouteErrorResponse } from "@/app/api/_route-error"
import { SubmissionStorageServiceError } from "@/services/submission-storage-service"
import { SubmissionServiceError } from "@/services/submission-service"
import { PublicFormServiceError } from "@/services/public-form-service"

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
  return createRouteErrorResponse(error, routeName, {
    event: "submission_route",
    failure: "Submission request failed.",
    known: [
      PublicFormServiceError,
      SubmissionServiceError,
      SubmissionStorageServiceError,
    ],
  })
}
