import { NextResponse } from "next/server"

import { readTrustedJsonObject } from "@/lib/request-security"
import { rebuildTemplateFlowProposal } from "@/services/template-flow-service"

import { createTemplateRouteErrorResponse, startFlowTurn } from "../../_utils"

/**
 * Rebuilds a pending Flow proposal from the changes its reviewer kept. No AI
 * call is made, and it spends from the rebuild bucket, not the AI budget.
 *
 * @param request - JSON with the template id, base draft, its fingerprint, and the kept changes.
 * @returns The rebuilt proposal, or a safe error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId, userId } = await startFlowTurn("rebuild")
    const body = await readTrustedJsonObject(request)
    const proposal = await rebuildTemplateFlowProposal({
      actorUserId: userId,
      baseDraftFingerprint: body.baseDraftFingerprint,
      draft: body.draft,
      operations: body.operations,
      organizationId,
      templateId: body.templateId,
    })

    return NextResponse.json({ proposal })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "templates_flow_rebuild")
  }
}
