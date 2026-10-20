import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { getRequiredString, readTrustedJsonObject } from "@/lib/request-security"
import { completeDocumentUpload, discardPendingDocumentUpload } from "@/services/document-service"

import {
  createDocumentRouteErrorResponse,
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
    const body = await readTrustedJsonObject(request)
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

/**
 * Takes back the member's own new document whose upload never completed.
 *
 * @param request - JSON request with the organization identifier.
 * @param context - Route context containing the document id path parameter.
 * @returns An empty success, or JSON error.
 */
export async function DELETE(
  request: Request,
  context: CompleteUploadRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { documentId } = await context.params

    await discardPendingDocumentUpload({
      actorUserId: user.id,
      organizationId: getRequiredString(body, "organizationId", "Organization id"),
      documentId,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_discard_upload")
  }
}
