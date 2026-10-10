import { NextResponse } from "next/server"

import { createTemplateRouteErrorResponse, startFlowTurn } from "@/app/api/templates/_utils"
import { readTrustedJsonObject } from "@/lib/request-security"
import { rebuildDocumentFlowProposal } from "@/services/template-flow-service"

/**
 * Rebuilds a pending document Flow proposal from the changes its reviewer
 * kept. No AI call is made, and it spends from the rebuild bucket, not the AI budget.
 *
 * @param request - JSON with the base page, its fingerprint, and the kept changes.
 * @param context - The document the proposal is about.
 * @returns The rebuilt proposal, or a safe error.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
): Promise<Response> {
  try {
    const { organizationId, userId } = await startFlowTurn("rebuild")
    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const proposal = await rebuildDocumentFlowProposal({
      actorUserId: userId,
      baseDraftFingerprint: body.baseDraftFingerprint,
      documentId,
      draft: body.draft,
      operations: body.operations,
      organizationId,
    })

    return NextResponse.json({ proposal })
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "documents_flow_rebuild")
  }
}
