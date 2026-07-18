import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { allocateInternalSubmissionFile } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionInteger,
  getRequiredSubmissionString,
} from "../../../_utils"

type SubmissionUploadUrlRouteContext = {
  params: Promise<{ submissionId: string }>
}

/**
 * Allocates one template file field and returns a create-only signed R2 PUT URL.
 *
 * @param request - Same-origin JSON request containing tenant and file metadata.
 * @param context - Route context containing the submission identifier.
 * @returns Pending file metadata and a short-lived signed upload URL.
 */
export async function POST(
  request: Request,
  context: SubmissionUploadUrlRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { submissionId } = await context.params
    const result = await allocateInternalSubmissionFile({
      actorUserId: user.id,
      organizationId: getRequiredSubmissionString(
        body,
        "organizationId",
        "Organization id"
      ),
      submissionId,
      expectedRevision: getRequiredSubmissionInteger(
        body,
        "expectedRevision",
        "Expected revision"
      ),
      fieldKey: getRequiredSubmissionString(body, "fieldKey", "File field"),
      originalFilename: getRequiredSubmissionString(
        body,
        "originalFilename",
        "Original filename"
      ),
      contentType: getRequiredSubmissionString(
        body,
        "contentType",
        "Content type"
      ),
      byteSize: getRequiredSubmissionInteger(body, "byteSize", "Byte size"),
      checksumSha256: getRequiredSubmissionString(
        body,
        "checksumSha256",
        "File checksum"
      ),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(
      error,
      "submission_file_upload_url"
    )
  }
}
