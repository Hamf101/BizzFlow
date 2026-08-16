import { NextResponse } from "next/server"

import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "@/app/api/submissions/_utils"
import { getClientIp } from "@/lib/client-ip"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import { supersedePublicFormFile } from "@/services/public-form-service"

type PublicFormFileSupersedeRouteContext = {
  params: Promise<{ token: string }>
}

/**
 * Removes an active public draft file through its recoverable tombstone state.
 *
 * @param request - Same-origin JSON request carrying opaque draft and file ids.
 * @param context - Route context containing the public form token.
 * @returns Only the removed file id; private object metadata is never exposed.
 */
export async function POST(
  request: Request,
  context: PublicFormFileSupersedeRouteContext
): Promise<Response> {
  try {
    const clientIp = getClientIp(request.headers)
    await checkRateLimit("public_form_file_upload", clientIp)

    const body = await readTrustedJsonObject(request)
    const { token } = await context.params
    const result = await supersedePublicFormFile({
      token,
      draftToken: getRequiredSubmissionString(
        body,
        "draftToken",
        "Form session"
      ),
      fileId: getRequiredSubmissionString(body, "fileId", "File id"),
    })

    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    })
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(
      error,
      "public_form_file_supersede"
    )
  }
}
