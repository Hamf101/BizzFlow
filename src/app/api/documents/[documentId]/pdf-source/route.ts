import { getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getCurrentOrganizationContext, OrganizationServiceError } from "@/services/organization-service"
import { readPdfForPlacing } from "@/services/pdf-signing-service"

import { createDocumentRouteErrorResponse } from "../../_utils"

type Context = { params: Promise<{ documentId: string }> }

/** The uploaded PDF fields are placed on, for a member placing them. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const organization = (await getCurrentOrganizationContext(user.id))?.organization

    if (!organization) {
      throw new OrganizationServiceError("Create or join an organization first.", 403)
    }

    await checkRateLimit("document_open", `${organization.id}:${user.id}`)
    const bytes = await readPdfForPlacing({ actorUserId: user.id, documentId: (await context.params).documentId, organizationId: organization.id })

    return new Response(new Uint8Array(bytes), { headers: PDF_HEADERS })
  } catch (error: unknown) {
    return createDocumentRouteErrorResponse(error, "document_pdf_source")
  }
}

const PDF_HEADERS = { "Cache-Control": "private, no-store", "Content-Type": "application/pdf", "X-Content-Type-Options": "nosniff" }
