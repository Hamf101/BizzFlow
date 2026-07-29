import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  executeTemplateFlow,
  TemplateFlowServiceError,
} from "@/services/template-flow-service"

import { createTemplateRouteErrorResponse } from "../_utils"

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

    // Gated before the body is parsed so an abusive caller never gets the parse
    // done on their behalf. Both buckets fail closed: an Upstash outage must not
    // silently remove the only ceiling on metered AI-provider spend.
    await checkRateLimit("ai_flow", `${context.organization.id}:${user.id}`)
    await checkRateLimit("ai_flow_daily", context.organization.id)

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
    return createTemplateRouteErrorResponse(error, "templates_flow")
  }
}
