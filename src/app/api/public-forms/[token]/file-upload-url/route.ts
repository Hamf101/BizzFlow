import { NextResponse } from "next/server"

import { getClientIp } from "@/lib/client-ip"
import { checkRateLimit } from "@/lib/rate-limit"
import { getRequiredString, readTrustedJsonObject } from "@/lib/request-security"
import { createPublicFormFileUploadUrl } from "@/services/public-form-service"
import {
  createSubmissionRouteErrorResponse,
  getRequiredSubmissionInteger,
} from "@/app/api/submissions/_utils"

type PublicFormUploadUrlRouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(
  request: Request,
  context: PublicFormUploadUrlRouteContext
): Promise<Response> {
  try {
    const clientIp = getClientIp(request.headers)
    await checkRateLimit("public_form_file_upload", clientIp)
    
    const body = await readTrustedJsonObject(request)
    const { token } = await context.params
    
    const rawDraftToken = body.draftToken

    const result = await createPublicFormFileUploadUrl({
      token,
      draftToken: typeof rawDraftToken === "string" ? rawDraftToken : null,
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
      "public_form_file_upload_url"
    )
  }
}
