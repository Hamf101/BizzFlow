import { NextResponse } from "next/server"

import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { createDocumentDownloadUrl } from "@/services/document-service"
import { getCurrentOrganizationContext, OrganizationServiceError } from "@/services/organization-service"
import { finalizeUploadedPdf } from "@/services/pdf-signing-service"

import { createDocumentRouteErrorResponse } from "../../_utils"

type Context = { params: Promise<{ documentId: string }> }

/** The signed copy of an uploaded PDF: stamped the first time it is asked for, the same file after. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const organization = (await getCurrentOrganizationContext(user.id))?.organization

    if (!organization) {
      throw new OrganizationServiceError("Create or join an organization first.", 403)
    }

    const { documentId } = await context.params
    await checkRateLimit("pdf_render", `${organization.id}:${documentId}`)
    const member = { actorUserId: user.id, documentId, organizationId: organization.id }
    const { versionId } = await finalizeUploadedPdf(member)
    const download = await createDocumentDownloadUrl({ ...member, versionId })

    return NextResponse.redirect(download.downloadUrl, {
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
      status: 307,
    })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_signed_pdf")
  }
}
