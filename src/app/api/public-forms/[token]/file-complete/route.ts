import { NextResponse } from "next/server"

import { getClientIp } from "@/lib/client-ip"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import { completePublicFormFileUpload } from "@/services/public-form-service"
import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionString,
} from "@/app/api/submissions/_utils"

type PublicFormFileCompleteRouteContext = {
  params: Promise<{ token: string }>
}

/**
 * Verifies an uploaded public form object before it counts toward submission.
 *
 * @param request - Unauthenticated JSON request carrying the draft handle.
 * @param context - Route context containing the public link token.
 * @returns The file identifier once its stored bytes are verified.
 */
export async function POST(
  request: Request,
  context: PublicFormFileCompleteRouteContext
): Promise<Response> {
  try {
    const clientIp = getClientIp(request.headers)
    await checkRateLimit("public_form_file_upload", clientIp)

    const body = await readTrustedJsonObject(request)
    const { token } = await context.params

    const result = await completePublicFormFileUpload({
      token,
      draftToken: getRequiredSubmissionString(
        body,
        "draftToken",
        "Form session"
      ),
      fileId: getRequiredSubmissionString(body, "fileId", "File id"),
    })

    return NextResponse.json(result)
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(error, "public_form_file_complete")
  }
}
