import { NextResponse } from "next/server"

import { createDocumentDownloadUrl } from "@/services/document-service"
import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { findFinalizedGeneratedDocumentVersionId } from "@/services/generated-document-finalization-service"

import { documentExportErrorResponse, exportFilename, loadDocumentExport } from "../../_export"

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
    const { documentId } = await context.params
    requestedDocumentId = documentId
    const { input, organizationId, readImage, userId, view } = await loadDocumentExport(documentId)

    // A guest's copy is the preview below, which shows signers as a signing
    // link does: the finalized paper carries every signer's email and signature.
    const finalizedVersionId =
      view.workflowStatus === "completed" && !view.guest
        ? await findFinalizedGeneratedDocumentVersionId({ actorUserId: userId, organizationId, documentId })
        : null

    if (finalizedVersionId) {
      const download = await createDocumentDownloadUrl({
        actorUserId: userId,
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
    const pdf = await renderGeneratedDocumentPdf(input, { fillable, readImage })

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${exportFilename(view.document.title, "pdf", fillable ? "fillable" : "preview")}"`,
        "Content-Length": String(pdf.length),
        "Content-Type": "application/pdf",
        "X-BizFlow-Pdf-State": "preview",
      },
    })
  } catch (error: unknown) {
    return documentExportErrorResponse(error, requestedDocumentId, "pdf", "Unable to download generated document PDF.")
  }
}
