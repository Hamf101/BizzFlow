import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  renderGeneratedDocumentPdf,
  DocumentPdfServiceError,
} from "@/services/document-pdf-service"
import {
  getGeneratedDocumentSigningView,
  DocumentSigningServiceError,
} from "@/services/document-signing-service"
import {
  getCurrentOrganizationContext,
  OrganizationServiceError,
} from "@/services/organization-service"

type GeneratedDocumentPdfRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Renders the current immutable generated-document snapshot as a private PDF.
 *
 * @param _request - Authenticated GET request.
 * @param context - Dynamic document route parameters.
 * @returns Downloadable PDF bytes or a user-safe JSON error.
 */
export async function GET(
  _request: Request,
  context: GeneratedDocumentPdfRouteContext
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser()
    const organizationContext = await getCurrentOrganizationContext(user.id)

    if (!organizationContext) {
      throw new DocumentSigningServiceError(
        "Create or join an organization before downloading documents.",
        403
      )
    }

    const { documentId } = await context.params
    const view = await getGeneratedDocumentSigningView({
      actorUserId: user.id,
      organizationId: organizationContext.organization.id,
      documentId,
    })
    const pdf = await renderGeneratedDocumentPdf({
      documentId: view.document.id,
      title: view.document.title,
      content: view.document.templateSnapshot,
      answers: view.answers,
      workflowStatus: view.workflowStatus,
      signers: view.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        requiresSignature: recipient.requiresSignature,
        status: recipient.status,
        signedAt: recipient.signedAt,
        signatureDataUrl: recipient.signatureDataUrl,
        initialsDataUrl: recipient.initialsDataUrl,
      })),
    })

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${createPdfFilename(
          view.document.title
        )}"`,
        "Content-Length": String(pdf.length),
        "Content-Type": "application/pdf",
      },
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    if (
      error instanceof DocumentSigningServiceError ||
      error instanceof DocumentPdfServiceError ||
      error instanceof OrganizationServiceError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    console.error("generated_document_pdf_route_failed", {
      reason: error instanceof Error ? error.message : "Unknown route error",
    })
    return NextResponse.json(
      { error: "Unable to download generated document PDF." },
      { status: 500 }
    )
  }
}

function createPdfFilename(title: string): string {
  const safeStem = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return `${safeStem || "document"}.pdf`
}
