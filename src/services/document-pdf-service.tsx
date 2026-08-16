import { DocumentPdfServiceError } from "./document-pdf/errors"
import { createPdfPagePlans } from "./document-pdf/planner"
import { renderPdfLibDocument } from "./document-pdf/pdf-lib-renderer"
import { normalizePdfInput } from "./document-pdf/shared"
import type { RenderGeneratedDocumentPdfInput } from "./document-pdf/types"

export { DocumentPdfServiceError } from "./document-pdf/errors"
export type {
  DocumentPdfSigner,
  RenderGeneratedDocumentPdfInput,
} from "./document-pdf/types"

/**
 * Renders an immutable guided document snapshot to a PDF buffer.
 *
 * @param input - Generated document snapshot, answers, workflow, and signer state.
 * @returns Complete PDF bytes suitable for download or private storage.
 * @throws DocumentPdfServiceError when validation or rendering fails.
 */
export async function renderGeneratedDocumentPdf(
  input: RenderGeneratedDocumentPdfInput
): Promise<Buffer> {
  const startedAt = performance.now()

  try {
    const normalizedInput = normalizePdfInput(input)
    const pages = createPdfPagePlans(normalizedInput)
    const buffer = await renderPdfLibDocument(normalizedInput, pages)

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
