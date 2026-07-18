import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  readTrustedJsonObject,
  RequestSecurityError,
} from "@/lib/request-security"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"
import {
  suggestTemplateBlocks,
  TemplateAiServiceError,
} from "@/services/template-ai-service"

/**
 * Creates non-mutating AI block proposals for the authenticated manager's draft.
 *
 * @param request - JSON request containing draft, section, and instruction.
 * @returns Canonical proposal blocks or a user-safe JSON error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new TemplateAiServiceError(
        "Create or join an organization before requesting suggestions.",
        403
      )
    }

    const body = await readTrustedJsonObject(request)
    const proposals = await suggestTemplateBlocks({
      actorUserId: user.id,
      organizationId: context.organization.id,
      draft: body.draft,
      section: body.section,
      instruction: body.instruction,
    })

    return NextResponse.json({ proposals })
  } catch (error: unknown) {
    return createTemplateAiErrorResponse(error)
  }
}

function createTemplateAiErrorResponse(error: unknown): Response {
  if (error instanceof RequestSecurityError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }

  if (error instanceof TemplateAiServiceError) {
    console.warn("template_ai_route_rejected", {
      reason: error.message,
      statusCode: error.statusCode,
    })
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  if (error instanceof OrganizationServiceError) {
    console.warn("template_ai_route_rejected", {
      reason: error.message,
      statusCode: error.statusCode,
    })
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }

  console.error("template_ai_route_failed", {
    reason: error instanceof Error ? error.message : "Unknown route error",
  })
  return NextResponse.json(
    { error: "Unable to create AI suggestions." },
    { status: 500 }
  )
}
