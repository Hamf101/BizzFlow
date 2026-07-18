import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { createDocumentDownloadUrl } from "@/services/document-service"

import {
  createDocumentRouteErrorResponse,
  getOptionalString,
  getRequiredString,
} from "../../_utils"

type DownloadUrlRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Creates a signed R2 GET URL for the current available document version.
 *
 * @param request - Same-origin JSON request with organization and optional version ids.
 * @param context - Route context containing the document id path parameter.
 * @returns Signed download URL response or JSON error.
 */
export async function POST(
  request: Request,
  context: DownloadUrlRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const { documentId } = await context.params
    const body = await readTrustedJsonObject(request)
    const organizationId = getRequiredString(
      body,
      "organizationId",
      "Organization id"
    )
    const versionId = getOptionalString(body, "versionId")

    const result = await createDocumentDownloadUrl({
      actorUserId: user.id,
      organizationId,
      documentId,
      versionId,
    })

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
      },
    })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_download_url")
  }
}
