import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { createDocumentDownloadUrl } from "@/services/document-service"

import { createDocumentRouteErrorResponse } from "../../_utils"

type DownloadUrlRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Creates a signed R2 GET URL for the current available document version.
 *
 * @param request - Request with organizationId query parameter.
 * @param context - Route context containing the document id path parameter.
 * @returns Signed download URL response or JSON error.
 */
export async function GET(
  request: Request,
  context: DownloadUrlRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const { documentId } = await context.params
    const url = new URL(request.url)
    const organizationId = url.searchParams.get("organizationId")?.trim()

    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization id is required." },
        { status: 400 }
      )
    }

    const result = await createDocumentDownloadUrl({
      actorUserId: user.id,
      organizationId,
      documentId,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_download_url")
  }
}
