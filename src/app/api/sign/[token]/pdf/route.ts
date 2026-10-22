import { readPdfForSigning } from "@/services/pdf-signing-service"

import { handleSigningRequest, PRIVATE_HEADERS } from "../_route"

type Context = { params: Promise<{ token: string }> }

/** The PDF a signer fills in, through their private link. */
export async function GET(request: Request, context: Context): Promise<Response> {
  return handleSigningRequest(request, "public_signing_pdf", async () => {
    const bytes = await readPdfForSigning({ token: (await context.params).token })
    return new Response(new Uint8Array(bytes), { headers: { ...PRIVATE_HEADERS, "Content-Type": "application/pdf" } })
  })
}
