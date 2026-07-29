import { NextResponse } from "next/server"

import { AuthenticationError } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { RequestSecurityError } from "@/lib/request-security"
import { OrganizationServiceError } from "@/services/organization-service"
import { TemplateFlowServiceError } from "@/services/template-flow-service"

/**
 * Converts typed template route failures into user-safe JSON responses.
 *
 * @param error - Unknown caught route failure.
 * @param routeName - Stable route identifier included in logs.
 * @returns JSON error response with an appropriate HTTP status.
 */
export function createTemplateRouteErrorResponse(
  error: unknown,
  routeName: string
): Response {
  if (error instanceof RateLimitError) {
    return createRateLimitResponse(error, "template_route_rejected", routeName)
  }

  if (error instanceof RequestSecurityError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }

  if (
    error instanceof TemplateFlowServiceError ||
    error instanceof OrganizationServiceError
  ) {
    console.warn("template_route_rejected", {
      reason: error.message,
      routeName,
      statusCode: error.statusCode,
    })
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  console.error("template_route_failed", {
    reason: error instanceof Error ? error.message : "Unknown route error",
    routeName,
  })
  captureUnexpectedError(error, { routeName })
  return NextResponse.json(
    { error: "Unable to complete the Flow request." },
    { status: 500 }
  )
}
