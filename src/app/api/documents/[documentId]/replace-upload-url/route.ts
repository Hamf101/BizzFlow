import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import {
  createDocumentReplacementUploadUrl,
  type CreateDocumentReplacementUploadUrlInput,
} from "@/services/document-service"

import {
  createDocumentRouteErrorResponse,
  getOptionalNonEmptyString,
  getRequiredNumber,
  getRequiredString,
} from "../../_utils"

type ReplaceUploadUrlRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Creates a pending version or refreshes its signed R2 PUT URL.
 *
 * @param request - JSON request with organization and replacement file metadata.
 * @param context - Route context containing the existing document id.
 * @returns Signed upload URL response or a specific JSON error.
 */
export async function POST(
  request: Request,
  context: ReplaceUploadUrlRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { documentId } = await context.params
    const input: CreateDocumentReplacementUploadUrlInput = {
      actorUserId: user.id,
      organizationId: getRequiredString(body, "organizationId", "Organization id"),
      documentId,
      pendingVersionId: getOptionalNonEmptyString(
        body,
        "pendingVersionId",
        "Pending version id"
      ),
      originalFilename: getRequiredString(
        body,
        "originalFilename",
        "Original filename"
      ),
      contentType: getRequiredString(body, "contentType", "Content type"),
      byteSize: getRequiredNumber(body, "byteSize", "Byte size"),
    }

    const result = await createDocumentReplacementUploadUrl(input)

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(
      error,
      "document_replacement_upload_url"
    )
  }
}
