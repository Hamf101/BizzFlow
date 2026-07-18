import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  createDocumentDownloadUrl,
  DocumentServiceError,
} from "@/services/document-service"
import {
  renderGeneratedDocumentPdf,
  DocumentPdfServiceError,
} from "@/services/document-pdf-service"
import {
  finalizeGeneratedDocumentPdf,
  GeneratedDocumentFinalizationServiceError,
} from "@/services/generated-document-finalization-service"
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
 * Delivers a private preview or redirects to the immutable finalized PDF.
 *
 * @param _request - Authenticated GET request.
 * @param context - Dynamic document route parameters.
 * @returns Preview PDF bytes, a signed final-download redirect, or a safe JSON error.
 */
export async function GET(
  _request: Request,
  context: GeneratedDocumentPdfRouteContext
): Promise<Response> {
  let requestedDocumentId: string | undefined

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
    requestedDocumentId = documentId
    const view = await getGeneratedDocumentSigningView({
      actorUserId: user.id,
      organizationId: organizationContext.organization.id,
      documentId,
    })

    if (view.workflowStatus === "completed") {
      const finalization = await finalizeGeneratedDocumentPdf({
        actorUserId: user.id,
        organizationId: organizationContext.organization.id,
        documentId,
      })
      const download = await createDocumentDownloadUrl({
        actorUserId: user.id,
        organizationId: organizationContext.organization.id,
        documentId,
        versionId: finalization.versionId,
      })

      return NextResponse.redirect(download.downloadUrl, {
        status: 307,
        headers: {
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
          "X-BizFlow-Pdf-State": "finalized",
        },
      })
    }

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
          view.document.title,
          "preview"
        )}"`,
        "Content-Length": String(pdf.length),
        "Content-Type": "application/pdf",
        "X-BizFlow-Pdf-State": "preview",
      },
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }

    if (
      error instanceof DocumentSigningServiceError ||
      error instanceof DocumentPdfServiceError ||
      error instanceof GeneratedDocumentFinalizationServiceError ||
      error instanceof DocumentServiceError ||
      error instanceof OrganizationServiceError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    console.error("generated_document_pdf_route_failed", {
      documentId: requestedDocumentId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
    return NextResponse.json(
      { error: "Unable to download generated document PDF." },
      { status: 500 }
    )
  }
}

function createPdfFilename(title: string, suffix?: string): string {
  const safeStem = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)

  return `${safeStem || "document"}${suffix ? `-${suffix}` : ""}.pdf`
}
