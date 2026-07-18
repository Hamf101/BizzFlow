import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { createInternalSubmissionFileDownloadUrl } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "../../../../_utils"

type DownloadSubmissionFileRouteContext = {
  params: Promise<{ fileId: string; submissionId: string }>
}

/**
 * Returns a short-lived private download URL for one available submission file.
 *
 * @param request - Same-origin JSON request containing the tenant identifier.
 * @param context - Route context containing submission and file identifiers.
 * @returns Signed attachment URL with explicit no-store response headers.
 */
export async function POST(
  request: Request,
  context: DownloadSubmissionFileRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { fileId, submissionId } = await context.params
    const result = await createInternalSubmissionFileDownloadUrl({
      actorUserId: user.id,
      organizationId: getRequiredSubmissionString(
        body,
        "organizationId",
        "Organization id"
      ),
      submissionId,
      fileId,
    })

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
      },
    })
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(
      error,
      "submission_file_download_url"
    )
  }
}
