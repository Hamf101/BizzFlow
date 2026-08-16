import { NextResponse } from "next/server"

import {
  createSubmissionRouteErrorResponse,
} from "@/app/api/submissions/_utils"
import { getClientIp } from "@/lib/client-ip"
import {
  getPublicFormDraftCookieOptions,
  PUBLIC_FORM_DRAFT_COOKIE_NAME,
} from "@/lib/public-form-draft-cookie"
import { checkRateLimit } from "@/lib/rate-limit"
import { readTrustedJsonObject } from "@/lib/request-security"
import {
  PublicFormServiceError,
  savePublicFormDraft,
} from "@/services/public-form-service"

type PublicFormDraftRouteContext = {
  params: Promise<{ token: string }>
}

/**
 * Checkpoints scalar public-form answers without finalizing the submission.
 *
 * @param request - Same-origin JSON request with optional optimistic draft identity.
 * @param context - Route context containing the public form token.
 * @returns Current opaque draft token and monotonically increasing revision.
 */
export async function POST(
  request: Request,
  context: PublicFormDraftRouteContext
): Promise<Response> {
  try {
    const clientIp = getClientIp(request.headers)
    await checkRateLimit("public_form_file_upload", clientIp)

    const body = await readTrustedJsonObject(request)
    const { token } = await context.params
    const rawValues = body.values

    if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) {
      throw new PublicFormServiceError("Form draft values are required.", 400)
    }

    const result = await savePublicFormDraft({
      token,
      draftToken:
        typeof body.draftToken === "string" ? body.draftToken : null,
      expectedRevision:
        typeof body.expectedRevision === "number"
          ? body.expectedRevision
          : null,
      values: rawValues as Record<string, unknown>,
    })
    const response = NextResponse.json(result)

    response.cookies.set(
      PUBLIC_FORM_DRAFT_COOKIE_NAME,
      result.draftToken,
      getPublicFormDraftCookieOptions(token)
    )

    return response
  } catch (error: unknown) {
    return createSubmissionRouteErrorResponse(error, "public_form_draft")
  }
}
