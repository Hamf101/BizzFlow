import { NextResponse } from "next/server"

import { createTemplateRouteErrorResponse, startFlowTurn } from "@/app/api/templates/_utils"
import { readTrustedJsonObject } from "@/lib/request-security"
import { executeDocumentFlow } from "@/services/template-flow-service"

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
    const { organizationId, userId } = await startFlowTurn()
    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const result = await executeDocumentFlow({
      actorUserId: userId,
      documentId,
      draft: body.draft,
      instruction: body.instruction,
      organizationId,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "documents_flow")
  }
}
