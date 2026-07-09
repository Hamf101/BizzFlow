import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { completeDocumentUpload } from "@/services/document-service"

import {
  createDocumentRouteErrorResponse,
  getRequiredString,
  readJsonObject,
} from "../../_utils"

type CompleteUploadRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Marks a pending document version as available after browser upload.
 *
 * @param request - JSON request with organization and version identifiers.
 * @param context - Route context containing the document id path parameter.
 * @returns Completed version DTO or JSON error.
 */
export async function POST(
  request: Request,
  context: CompleteUploadRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readJsonObject(request)
    const { documentId } = await context.params
    const version = await completeDocumentUpload({
      actorUserId: user.id,
      organizationId: getRequiredString(body, "organizationId", "Organization id"),
      documentId,
      versionId: getRequiredString(body, "versionId", "Version id"),
    })

    return NextResponse.json({ version })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_complete_upload")
  }
}
