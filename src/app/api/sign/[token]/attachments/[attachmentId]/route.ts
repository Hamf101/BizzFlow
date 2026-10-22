import { NextResponse } from "next/server"

import { confirmPdfAttachmentUpload } from "@/services/pdf-signing-service"

import { handleSigningRequest, PRIVATE_HEADERS } from "../../_route"

type Context = { params: Promise<{ attachmentId: string; token: string }> }

/** Counts a signer's attachment once its file has arrived and checks out. */
export async function POST(request: Request, context: Context): Promise<Response> {
  return handleSigningRequest(request, "public_signing_attachment_confirm", async () => {
    const { attachmentId, token } = await context.params
    return NextResponse.json(await confirmPdfAttachmentUpload({ attachmentId, token }), { headers: PRIVATE_HEADERS })
  })
}
