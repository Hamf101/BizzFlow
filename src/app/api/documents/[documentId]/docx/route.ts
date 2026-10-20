import { renderGeneratedDocumentDocx } from "@/services/document-docx-service"

import { documentExportErrorResponse, docxDownload, exportFilename, loadDocumentExport } from "../../_export"

// A long document renders in a few seconds; this leaves room for pictures and a busy moment.
export const maxDuration = 60

type GeneratedDocumentDocxRouteContext = {
  params: Promise<{ documentId: string }>
}

/**
 * Delivers a document as Word, laid out as its PDF: whoever may download the
 * PDF may download this, a guest seeing signers as the PDF shows them. A
 * completed document prints from the snapshot and answers it was finalized from.
 *
 * @param _request - Authenticated GET request.
 * @param context - Dynamic document route parameters.
 * @returns The .docx bytes, or a safe JSON error.
 */
export async function GET(_request: Request, context: GeneratedDocumentDocxRouteContext): Promise<Response> {
  let requestedDocumentId: string | undefined

  try {
    const { documentId } = await context.params
    requestedDocumentId = documentId
    const { input, readImage, view } = await loadDocumentExport(documentId)

    return docxDownload(await renderGeneratedDocumentDocx(input, { readImage }), exportFilename(view.document.title, "docx"))
  } catch (error: unknown) {
    return documentExportErrorResponse(error, requestedDocumentId, "docx", "Unable to download the document as Word.")
  }
}

