import { createTemplateRouteErrorResponse, startFlowTurn, streamFlowTurn } from "@/app/api/templates/_utils"
import { readTrustedJsonObject } from "@/lib/request-security"
import { executeWorkspaceFlow } from "@/services/workspace-flow-service"

// A turn is up to three model calls: two to get a valid draft and one rewrite.
export const maxDuration = 300

/**
 * Completes one Flow turn sent from a workspace page.
 *
 * @param request - JSON request with the message, the conversation so far, and an optional form to recreate.
 * @returns Work found, something to start, or a reply; or a safe error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId, userId } = await startFlowTurn()
    const body = await readTrustedJsonObject(request)

    return await streamFlowTurn(request, "workspace_flow", (onStage) =>
      executeWorkspaceFlow(
        {
          actorUserId: userId,
          history: body.history,
          mentions: body.mentions,
          message: body.message,
          model: body.model,
          organizationId,
          sourceDocumentId: body.sourceDocumentId,
        },
        { onStage }
      )
    )
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "workspace_flow")
  }
}
