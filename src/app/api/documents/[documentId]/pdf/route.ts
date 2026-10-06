import { NextResponse } from "next/server"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { resolveDocumentOrganizationId } from "@/lib/document-organization"
import { captureUnexpectedError, describeErrorForLog } from "@/lib/observability"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"
import {
  createDocumentDownloadUrl,
  DocumentServiceError,
} from "@/services/document-service"
import {
  renderGeneratedDocumentPdf,
  DocumentPdfServiceError,
} from "@/services/document-pdf-service"
import {
  findFinalizedGeneratedDocumentVersionId,
  GeneratedDocumentFinalizationServiceError,
} from "@/services/generated-document-finalization-service"
import {
  getGeneratedDocumentSigningView,
  DocumentSigningServiceError,
} from "@/services/document-signing-service"
import { OrganizationServiceError } from "@/services/organization-service"
import { readTemplateImage } from "@/services/template-image-service"
import type { DocumentSigningRecipient, PublicSignerStatus } from "@/types/signing"

// A long document renders in a few seconds; this leaves room for pictures and a busy moment.
export const maxDuration = 60

type GeneratedDocumentPdfRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Delivers a private preview or redirects to the immutable finalized PDF.
 * Reading never finalizes: the last signature does (see the signing action).
 *
 * @param request - Authenticated GET request; `?fillable=1` asks for form fields.
 * @param context - Dynamic document route parameters.
 * @returns Preview PDF bytes, a signed final-download redirect, or a safe JSON error.
 */
export async function GET(
  request: Request,
  context: GeneratedDocumentPdfRouteContext
): Promise<Response> {
  let requestedDocumentId: string | undefined

  try {
    const user = await getAuthenticatedUser()
    const { documentId } = await context.params
    requestedDocumentId = documentId
    const organizationId = await resolveDocumentOrganizationId(user.id, documentId)

    if (!organizationId) {
      throw new DocumentSigningServiceError(
        "Create or join an organization before downloading documents.",
        403
      )
    }

    // Keyed on the document because the preview path below re-renders the whole
    // PDF on every request (no-store), so a hot loop on one large document is
    // the expensive case rather than a member opening many documents.
    await checkRateLimit(
      "pdf_render",
      `${organizationId}:${documentId}`
    )
    // And on the member, so cycling through many documents is not free either.
    await checkRateLimit("pdf_render_user", user.id)

    const view = await getGeneratedDocumentSigningView({
      actorUserId: user.id,
      organizationId,
      documentId,
    })

    const finalizedVersionId =
      view.workflowStatus === "completed"
        ? await findFinalizedGeneratedDocumentVersionId({ actorUserId: user.id, organizationId, documentId })
        : null

    if (finalizedVersionId) {
      const download = await createDocumentDownloadUrl({
        actorUserId: user.id,
        organizationId,
        documentId,
        versionId: finalizedVersionId,
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

    // A signed document has no fillable copy: its answers stand as signed.
    const fillable = new URL(request.url).searchParams.get("fillable") === "1"
    const pdf = await renderGeneratedDocumentPdf({
      documentId: view.document.id,
      title: view.document.title,
      content: view.document.templateSnapshot,
      answers: view.answers,
      workflowStatus: view.workflowStatus,
      // A guest's copy shows its signers as a signing link shows co-signers.
      signers: view.recipients.map((recipient: PublicSignerStatus & Partial<DocumentSigningRecipient>) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email ?? "",
        requiresSignature: recipient.requiresSignature,
        status: recipient.status,
        signedAt: recipient.signedAt,
        signatureDataUrl: recipient.signatureDataUrl ?? null,
        initialsDataUrl: recipient.initialsDataUrl ?? null,
      })),
    }, {
      fillable,
      readImage: (asset) => readTemplateImage(organizationId, asset),
    })

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${createPdfFilename(
          view.document.title,
          fillable ? "fillable" : "preview"
        )}"`,
        "Content-Length": String(pdf.length),
        "Content-Type": "application/pdf",
        "X-BizFlow-Pdf-State": "preview",
      },
    })
  } catch (error: unknown) {
    if (error instanceof RateLimitError) {
      return createRateLimitResponse(
        error,
        "document_route_rejected",
        "documents_pdf"
      )
    }

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
      if (error.statusCode >= 500) {
        console.error("generated_document_pdf_route_failed", {
          documentId: requestedDocumentId,
          ...describeErrorForLog(error),
        })
      }

      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }

    console.error("generated_document_pdf_route_failed", {
      documentId: requestedDocumentId,
      ...describeErrorForLog(error),
    })
    captureUnexpectedError(error, {
      routeName: "documents_pdf",
      documentId: requestedDocumentId,
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
