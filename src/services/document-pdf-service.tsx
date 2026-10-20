import { DocumentPdfServiceError } from "./document-pdf/errors"
import { createPdfPagePlans } from "./document-pdf/planner"
import { renderPdfLibDocument } from "./document-pdf/pdf-lib-renderer"
import { normalizePdfInput } from "./document-pdf/shared"
import type { PdfLibRenderContext } from "./document-pdf/pdf-lib-types"
import type { NormalizedPdfInput, PdfPagePlan, RenderGeneratedDocumentPdfInput } from "./document-pdf/types"

export { DocumentPdfServiceError } from "./document-pdf/errors"

/**
 * Reads stored pictures' print copies, for documents that have them; a
 * fillable PDF holds its answers in form fields someone can change in a viewer.
 */
export type RenderGeneratedDocumentPdfOptions = { fillable?: boolean; readImage?: PdfLibRenderContext["readImage"] }
export type {
  RenderGeneratedDocumentPdfInput,
} from "./document-pdf/types"

/**
 * Renders an immutable guided document snapshot to a PDF buffer.
 *
 * @param input - Generated document snapshot, answers, workflow, and signer state.
 * @param options - Reads stored pictures' print copies; `fillable` adds form fields.
 * @returns Complete PDF bytes suitable for download or private storage.
 * @throws DocumentPdfServiceError when validation or rendering fails.
 */
export async function renderGeneratedDocumentPdf(
  input: RenderGeneratedDocumentPdfInput,
  options: RenderGeneratedDocumentPdfOptions = {}
): Promise<Buffer> {
  return renderPlannedDocument("pdf", "a PDF", input, options, (normalized, pages) => renderPdfLibDocument(normalized, pages, options))
}

/**
 * Validates a document, plans its pages as the PDF does, and writes them in
 * one format, logging how long it took; anything unexpected becomes a safe 500.
 *
 * @param format - The format's name in logs.
 * @param asWhat - The format in the error a reader sees, such as "a PDF".
 * @param render - Writes the planned pages.
 * @throws DocumentPdfServiceError when validation or rendering fails.
 */
export async function renderPlannedDocument(
  format: string,
  asWhat: string,
  input: RenderGeneratedDocumentPdfInput,
  options: RenderGeneratedDocumentPdfOptions,
  render: (input: NormalizedPdfInput, pages: PdfPagePlan[]) => Promise<Buffer>
): Promise<Buffer> {
  const startedAt = performance.now()

  try {
    const normalizedInput = normalizePdfInput(input, { fillable: options.fillable })
    const pages = createPdfPagePlans(normalizedInput)
    const buffer = await render(normalizedInput, pages)

    console.info(`generated_document_${format}_rendered`, {
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

    console.error(`generated_document_${format}_render_failed`, {
      documentId: input.documentId,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : `Unknown ${format.toUpperCase()} render error`,
    })
    throw new DocumentPdfServiceError(
      `Unable to render this document as ${asWhat}.`,
      500
    )
  }
}
