import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import { RequestSecurityError } from "@/lib/request-security"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import { TemplateFlowServiceError } from "@/services/template-flow-service"

/**
 * Signs the member in and spends one Flow turn from both of their buckets,
 * the same for every surface Flow answers on.
 *
 * @returns The member and the organization the turn belongs to.
 * @throws TemplateFlowServiceError without an organization; RateLimitError past a limit.
 */
export async function startFlowTurn(): Promise<{ organizationId: string; userId: string }> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new TemplateFlowServiceError(
      "Create or join an organization before using Flow.",
      403
    )
  }

  // Gated before the body is parsed so an abusive caller never gets the parse
  // done on their behalf. Both buckets fail closed: an Upstash outage must not
  // silently remove the only ceiling on metered AI-provider spend.
  await checkRateLimit("ai_flow", `${context.organization.id}:${user.id}`)
  await checkRateLimit("ai_flow_daily", context.organization.id)

  return { organizationId: context.organization.id, userId: user.id }
}

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
