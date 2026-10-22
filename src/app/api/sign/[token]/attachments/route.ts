import { NextResponse } from "next/server"

import { readTrustedJsonObject } from "@/lib/request-security"
import { createPdfAttachmentUpload } from "@/services/pdf-signing-service"

import { handleSigningRequest, PRIVATE_HEADERS } from "../_route"

type Context = { params: Promise<{ token: string }> }

/** Starts a signer's attachment: where to put the file. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return handleSigningRequest(request, "public_signing_attachment", async () => {
    const body = await readTrustedJsonObject(request)
    const text = (key: string) => (typeof body[key] === "string" ? (body[key] as string) : "")
    const started = await createPdfAttachmentUpload({
      byteSize: typeof body.byteSize === "number" ? body.byteSize : 0,
      contentType: text("contentType"),
      fieldId: text("fieldId"),
      filename: text("filename"),
      token: (await context.params).token,
    })

    return NextResponse.json(started, { headers: PRIVATE_HEADERS })
  })
}
