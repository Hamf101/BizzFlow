import { createRouteErrorResponse } from "@/app/api/_route-error"
import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getRequiredString, readTrustedJsonObject } from "@/lib/request-security"
import {
  recordDocumentRecentAccess,
  TemplateServiceError,
} from "@/services/template-service"

type DocumentOpenedRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Records the authenticated member's latest real open time for one document.
 *
 * @param request - JSON request containing the active organization id.
 * @param context - Dynamic document route parameters.
 * @returns Empty success response or a user-safe JSON error.
 */
export async function POST(
  request: Request,
  context: DocumentOpenedRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    // Keyed on the member alone: the organizationId below comes from the request
    // body and stays unverified until the service checks membership, so keying
    // on it would let a caller rotate the value to mint fresh buckets.
    await checkRateLimit("document_open", user.id)

    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const organizationId = getRequiredString(body, "organizationId", "Organization id")

    await recordDocumentRecentAccess({
      actorUserId: user.id,
      organizationId,
      documentId,
    })
    return new Response(null, { status: 204 })
  } catch (error: unknown) {
    return createRouteErrorResponse(error, "documents_opened", {
      event: "document_open_route",
      failure: "Unable to record document open.",
      known: [TemplateServiceError],
    })
  }
}
