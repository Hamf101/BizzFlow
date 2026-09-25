import { DocumentPdfServiceError } from "./document-pdf/errors"
import { createPdfPagePlans } from "./document-pdf/planner"
import { renderPdfLibDocument } from "./document-pdf/pdf-lib-renderer"
import { normalizePdfInput } from "./document-pdf/shared"
import type { PdfLibRenderContext } from "./document-pdf/pdf-lib-types"
import type { RenderGeneratedDocumentPdfInput } from "./document-pdf/types"

export { DocumentPdfServiceError } from "./document-pdf/errors"

/** Reads stored pictures' print copies, for documents that have them. */
export type RenderGeneratedDocumentPdfOptions = { readImage?: PdfLibRenderContext["readImage"] }
export type {
  DocumentPdfSigner,
  RenderGeneratedDocumentPdfInput,
} from "./document-pdf/types"

/**
 * Renders an immutable guided document snapshot to a PDF buffer.
 *
 * @param input - Generated document snapshot, answers, workflow, and signer state.
 * @param options - Reads stored pictures' print copies, for documents that have them.
 * @returns Complete PDF bytes suitable for download or private storage.
 * @throws DocumentPdfServiceError when validation or rendering fails.
 */
export async function renderGeneratedDocumentPdf(
  input: RenderGeneratedDocumentPdfInput,
  options: RenderGeneratedDocumentPdfOptions = {}
): Promise<Buffer> {
  const startedAt = performance.now()

  try {
    const normalizedInput = normalizePdfInput(input)
    const pages = createPdfPagePlans(normalizedInput)
    const buffer = await renderPdfLibDocument(normalizedInput, pages, options.readImage)

    console.info("generated_document_pdf_rendered", {
      documentId: input.documentId,
      byteSize: buffer.length,
      pageCount: pages.length,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return buffer
  } catch (error: unknown) {
    if (error instanceof DocumentPdfServiceError) {
      throw error
    }

    console.error("generated_document_pdf_render_failed", {
      documentId: input.documentId,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : "Unknown PDF render error",
    })
    throw new DocumentPdfServiceError(
      "Unable to render this document as a PDF.",
      500
    )
  }
}
