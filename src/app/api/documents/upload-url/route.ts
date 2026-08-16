import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import {
  createDocumentUploadUrl,
  type CreateDocumentUploadUrlInput,
} from "@/services/document-service"

import {
  createDocumentRouteErrorResponse,
  getOptionalString,
  getRequiredNumber,
  getRequiredString,
} from "../_utils"

/**
 * Creates a document metadata row, upload-pending version, and signed R2 PUT URL.
 *
 * @param request - JSON request with organization, document, and file metadata.
 * @returns Signed upload URL response or JSON error.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    await checkRateLimit("upload_initiation", user.id)
    const body = await readTrustedJsonObject(request)
    const input: CreateDocumentUploadUrlInput = {
      actorUserId: user.id,
      organizationId: getRequiredString(body, "organizationId", "Organization id"),
      folderId: getOptionalString(body, "folderId"),
      title: getRequiredString(body, "title", "Document title"),
      description: getOptionalString(body, "description"),
      originalFilename: getRequiredString(
        body,
        "originalFilename",
        "Original filename"
      ),
      contentType: getRequiredString(body, "contentType", "Content type"),
      byteSize: getRequiredNumber(body, "byteSize", "Byte size"),
    }

    const result = await createDocumentUploadUrl(input)

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_upload_url")
  }
}
