import { NextResponse } from "next/server"

import { AuthenticationError } from "@/lib/auth"
import { DocumentServiceError } from "@/services/document-service"

/**
 * Reads a JSON object request body.
 *
 * @param request - Incoming route request.
 * @returns Parsed JSON object.
 * @throws DocumentServiceError when the body is missing, invalid, or not an object.
 */
export async function readJsonObject(
  request: Request
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json()

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new DocumentServiceError("Request body must be a JSON object.", 400)
    }

    return body as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError) {
      throw error
    }

    throw new DocumentServiceError("Request body must be valid JSON.", 400)
  }
}

/**
 * Reads a required string field from a parsed JSON body.
 *
 * @param body - Parsed JSON body.
 * @param key - Field name to read.
 * @param label - User-safe field label for validation errors.
 * @returns Trimmed string value.
 * @throws DocumentServiceError when the field is missing or empty.
 */
export function getRequiredString(
  body: Record<string, unknown>,
  key: string,
  label: string
): string {
  const value = body[key]

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DocumentServiceError(`${label} is required.`, 400)
  }

  return value.trim()
}

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
 * Converts route errors into JSON responses.
 *
 * @param error - Unknown caught error.
 * @param routeName - Route identifier for logs.
 * @returns JSON error response with a specific status code.
 */
export function createDocumentRouteErrorResponse(
  error: unknown,
  routeName: string
): Response {
  if (error instanceof AuthenticationError) {
    console.warn("document_route_rejected", {
      routeName,
      reason: error.message,
      statusCode: 401,
    })
    return NextResponse.json({ error: error.message }, { status: 401 })
  }

  if (error instanceof DocumentServiceError) {
    console.warn("document_route_rejected", {
      routeName,
      reason: error.message,
      statusCode: error.statusCode,
    })
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }

  console.error("document_route_failed", {
    routeName,
    reason: error instanceof Error ? error.message : "Unknown route error",
  })
  return NextResponse.json({ error: "Document request failed." }, { status: 500 })
}
