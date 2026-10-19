import { createTemplateRouteErrorResponse, startFlowTurn, streamFlowTurn } from "@/app/api/templates/_utils"
import { readTrustedJsonObject } from "@/lib/request-security"
import { executeDocumentFlow } from "@/services/template-flow-service"

// A turn is up to three model calls: two to get a valid draft and one rewrite.
export const maxDuration = 300

/**
 * Completes one Flow chat turn about a generated document's own page.
 *
 * @param request - JSON request with the editor's current page, the message, and an optional uploaded form to recreate.
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
    return await streamFlowTurn(request, "documents_flow", (onStage) => executeDocumentFlow({
      actorUserId: userId,
      documentId,
      draft: body.draft,
      instruction: body.instruction,
      mentions: body.mentions,
      model: body.model,
      organizationId,
      sourceDocumentId: body.sourceDocumentId,
    }, { onStage }))
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "documents_flow")
  }
}
