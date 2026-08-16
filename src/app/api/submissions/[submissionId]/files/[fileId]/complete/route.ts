import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { completeInternalSubmissionFile } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "../../../../_utils"

type CompleteSubmissionFileRouteContext = {
  params: Promise<{ fileId: string; submissionId: string }>
}

/**
 * Downloads and verifies an uploaded object before promoting its pending allocation.
 *
 * @param request - Same-origin JSON request containing the tenant identifier.
 * @param context - Route context containing submission and file identifiers.
 * @returns Available file metadata after exact object verification.
 */
export async function POST(
  request: Request,
  context: CompleteSubmissionFileRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { fileId, submissionId } = await context.params
    const result = await completeInternalSubmissionFile({
      actorUserId: user.id,
      organizationId: getRequiredSubmissionString(
        body,
        "organizationId",
        "Organization id"
      ),
      submissionId,
      fileId,
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(
      error,
      "submission_file_complete"
    )
  }
}
