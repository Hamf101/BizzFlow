import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { readTrustedJsonObject } from "@/lib/request-security"
import { getInternalSubmissionPreview } from "@/services/submission-service"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "../../_utils"

type PreviewSubmissionRouteContext = {
  params: Promise<{ submissionId: string }>
}

/**
 * Returns what the list's hover preview draws for one visible submission.
 *
 * @param request - Same-origin JSON request containing the tenant identifier.
 * @param context - Route context containing the submission identifier.
 * @returns The submission's title, snapshot, and answers, never cached.
 */
export async function POST(
  request: Request,
  context: PreviewSubmissionRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const body = await readTrustedJsonObject(request)
    const { submissionId } = await context.params
    const preview = await getInternalSubmissionPreview({
      actorUserId: user.id,
      organizationId: getRequiredSubmissionString(
        body,
        "organizationId",
        "Organization id"
      ),
      submissionId,
    })

    return NextResponse.json(preview, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
      },
    })
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(error, "submission_preview")
  }
}
