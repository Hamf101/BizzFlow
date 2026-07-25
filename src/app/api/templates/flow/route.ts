import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import {
  readTrustedJsonObject,
  RequestSecurityError,
} from "@/lib/request-security"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import {
  executeTemplateFlow,
  TemplateFlowServiceError,
} from "@/services/template-flow-service"

/**
 * Completes one authenticated Flow chat turn and returns a validated next draft.
 *
 * @param request - JSON request with template id, current draft, and user message.
 * @returns Canonical draft changes, attributed chat messages, or a safe error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new TemplateFlowServiceError(
        "Create or join an organization before using Flow.",
        403
      )
    }

    const body = await readTrustedJsonObject(request)
    const result = await executeTemplateFlow({
      actorUserId: user.id,
      organizationId: context.organization.id,
      templateId: body.templateId,
      draft: body.draft,
      instruction: body.instruction,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createTemplateFlowErrorResponse(error)
  }
}

function createTemplateFlowErrorResponse(error: unknown): Response {
  if (error instanceof RequestSecurityError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }

  if (error instanceof TemplateFlowServiceError) {
    console.warn("template_flow_route_rejected", {
      reason: error.message,
      statusCode: error.statusCode,
    })
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  if (error instanceof OrganizationServiceError) {
    console.warn("template_flow_route_rejected", {
      reason: error.message,
      statusCode: error.statusCode,
    })
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  console.error("template_flow_route_failed", {
    reason: error instanceof Error ? error.message : "Unknown route error",
  })
  captureUnexpectedError(error, { routeName: "templates_flow" })
  return NextResponse.json(
    { error: "Unable to complete the Flow request." },
    { status: 500 }
  )
}
