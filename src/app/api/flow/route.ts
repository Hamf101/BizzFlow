import { NextResponse } from "next/server"

import { createTemplateRouteErrorResponse, startFlowTurn } from "@/app/api/templates/_utils"
import { readTrustedJsonObject } from "@/lib/request-security"
import { executeWorkspaceFlow } from "@/services/workspace-flow-service"

/**
 * Completes one Flow turn sent from a workspace page.
 *
 * @param request - JSON request with the message and the conversation so far.
 * @returns Work found, something to start, or a reply; or a safe error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { organizationId, userId } = await startFlowTurn()
    const body = await readTrustedJsonObject(request)

    return NextResponse.json(
      await executeWorkspaceFlow({
        actorUserId: userId,
        history: body.history,
        message: body.message,
        organizationId,
      })
    )
  } catch (error: unknown) {
    return createTemplateRouteErrorResponse(error, "workspace_flow")
  }
}
