import { NextResponse } from "next/server"

import { readTrustedJsonObject } from "@/lib/request-security"
import { executeTemplateFlow } from "@/services/template-flow-service"

import { createTemplateRouteErrorResponse, startFlowTurn } from "../_utils"

/**
 * Completes one authenticated Flow chat turn and returns a pending proposal.
 *
 * @param request - JSON request with template id, current draft, and user message.
 * @returns A staged candidate batch, attributed messages, or a safe error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId, userId } = await startFlowTurn()
    const body = await readTrustedJsonObject(request)
    const result = await executeTemplateFlow({
      actorUserId: userId,
      organizationId,
      templateId: body.templateId,
      draft: body.draft,
      instruction: body.instruction,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "templates_flow")
  }
}
