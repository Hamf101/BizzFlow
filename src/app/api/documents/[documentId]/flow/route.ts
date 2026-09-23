import { NextResponse } from "next/server"

import { createTemplateRouteErrorResponse } from "@/app/api/templates/_utils"
import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { executeDocumentFlow, TemplateFlowServiceError } from "@/services/template-flow-service"

/**
 * Completes one Flow chat turn about a generated document's own page.
 *
 * @param request - JSON request with the editor's current page and the message.
 * @param context - The document the turn is about.
 * @returns A staged candidate batch and the turn's messages, or a safe error.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const organization = await getCurrentOrganizationContext(user.id)

    if (!organization) {
      throw new TemplateFlowServiceError("Create or join an organization before using Flow.", 403)
    }

    // The same two buckets as template Flow: one spend ceiling for every surface.
    await checkRateLimit("ai_flow", `${organization.organization.id}:${user.id}`)
    await checkRateLimit("ai_flow_daily", organization.organization.id)

    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const result = await executeDocumentFlow({
      actorUserId: user.id,
      documentId,
      draft: body.draft,
      instruction: body.instruction,
      organizationId: organization.organization.id,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "documents_flow")
  }
}
