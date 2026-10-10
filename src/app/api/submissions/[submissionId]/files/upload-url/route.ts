import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getRequiredString, readTrustedJsonObject } from "@/lib/request-security"
import { allocateInternalSubmissionFile } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionInteger,
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
    await checkRateLimit("upload_initiation", user.id)
    const body = await readTrustedJsonObject(request)
    const { submissionId } = await context.params
    const result = await allocateInternalSubmissionFile({
      actorUserId: user.id,
      organizationId: getRequiredString(
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
      fieldKey: getRequiredString(body, "fieldKey", "File field"),
      originalFilename: getRequiredString(
        body,
        "originalFilename",
        "Original filename"
      ),
      contentType: getRequiredString(
        body,
        "contentType",
        "Content type"
      ),
      byteSize: getRequiredSubmissionInteger(body, "byteSize", "Byte size"),
      checksumSha256: getRequiredString(
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
