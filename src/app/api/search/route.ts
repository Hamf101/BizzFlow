import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { captureUnexpectedError } from "@/lib/observability"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { searchWorkspace, WorkspaceSearchError } from "@/services/workspace-search-service"

/**
 * Searches the member's workspace as they type.
 *
 * @param request - GET with the words as `q` and, optionally, one section as `kind`.
 * @returns What was found and each section's total, or a safe error.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (!context) {
      throw new WorkspaceSearchError("Create or join an organization before searching.", 403)
    }

    const params = new URL(request.url).searchParams
    const result = await searchWorkspace(
      { actorUserId: user.id, kind: params.get("kind"), organizationId: context.organization.id, query: params.get("q") },
      // The membership was just read; the search needn't read it again.
      { loadMembership: async () => context.membership }
    )

    // Private to the member, and out of date as soon as anything changes.
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    if (error instanceof WorkspaceSearchError && error.statusCode < 500) {
      console.warn("workspace_search_route_rejected", { reason: error.message, statusCode: error.statusCode })
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }

    captureUnexpectedError(error, { routeName: "workspace_search" })
    return NextResponse.json({ error: "Search failed. Try again." }, { status: 500 })
  }
}
