import { createRouteErrorResponse } from "@/app/api/_route-error"
import { getRequiredString } from "@/lib/request-security"
import { DocumentServiceError } from "@/services/document-service"
import { DocumentSigningServiceError } from "@/services/document-signing-service"
import { GeneratedDocumentFinalizationServiceError } from "@/services/generated-document-finalization-service"
import { OrganizationServiceError } from "@/services/organization-service"

/**
 * Reads an optional string field from a parsed JSON body.
 *
 * @param body - Parsed JSON body.
 * @param key - Field name to read.
 * @returns Trimmed string value, or null when absent or empty.
 */
export function getOptionalString(
  body: Record<string, unknown>,
  key: string
): string | null {
  const value = body[key]

  if (typeof value !== "string") {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}

/**
 * Reads a string that may be omitted but cannot be blank or non-string when present.
 *
 * @param body - Parsed JSON body.
 * @param key - Field name to read.
 * @param label - User-safe field label for validation errors.
 * @returns Trimmed string value, or undefined when the field is omitted.
 * @throws DocumentServiceError when a present field is not a non-empty string.
 */
export function getOptionalNonEmptyString(
  body: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  if (!(key in body)) {
    return undefined
  }

  return getRequiredString(body, key, label)
}

/**
 * Reads a required numeric field from a parsed JSON body.
 *
 * @param body - Parsed JSON body.
 * @param key - Field name to read.
 * @param label - User-safe field label for validation errors.
 * @returns Parsed numeric value.
 * @throws DocumentServiceError when the field is missing or invalid.
 */
export function getRequiredNumber(
  body: Record<string, unknown>,
  key: string,
  label: string
): number {
  const value = body[key]
  const parsedValue = typeof value === "number" ? value : Number(value)

  if (!Number.isFinite(parsedValue)) {
    throw new DocumentServiceError(`${label} must be a number.`, 400)
  }

  return parsedValue
}

/**
 * Converts document route failures into user-safe JSON responses.
 *
 * @param error - Unknown caught error.
 * @param routeName - Route identifier for logs.
 * @returns JSON error response with a specific status code.
 */
export function createDocumentRouteErrorResponse(
  error: unknown,
  routeName: string
): Response {
  return createRouteErrorResponse(error, routeName, {
    event: "document_route",
    failure: "Document request failed.",
    known: [DocumentServiceError, DocumentSigningServiceError, GeneratedDocumentFinalizationServiceError, OrganizationServiceError],
  })
}
