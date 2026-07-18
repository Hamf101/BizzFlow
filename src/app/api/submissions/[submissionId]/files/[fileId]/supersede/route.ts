import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { supersedeInternalSubmissionFile } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "../../../../_utils"

type SupersedeSubmissionFileRouteContext = {
  params: Promise<{ fileId: string; submissionId: string }>
}

/**
 * Tombstones a pending or available draft file so its field can be reused.
 *
 * @param request - Same-origin JSON request containing the tenant identifier.
 * @param context - Route context containing submission and file identifiers.
 * @returns Superseded file identity after the database transition.
 */
export async function POST(
  request: Request,
  context: SupersedeSubmissionFileRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { fileId, submissionId } = await context.params
    const result = await supersedeInternalSubmissionFile({
      actorUserId: user.id,
      organizationId: getRequiredSubmissionString(
        body,
        "organizationId",
        "Organization id"
      ),
      submissionId,
      fileId,
    })

    return NextResponse.json(
      { fileId: result.fileId },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
        },
      }
    )
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(
      error,
      "submission_file_supersede"
    )
  }
}
