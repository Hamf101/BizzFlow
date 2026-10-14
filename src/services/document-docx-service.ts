import { renderDocxDocument } from "./document-docx/docx-renderer"
import { renderPlannedDocument, type RenderGeneratedDocumentPdfInput } from "./document-pdf-service"
import type { PdfLibRenderContext } from "./document-pdf/pdf-lib-types"

/** The media type a .docx is served as. */
export const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * Renders a document as Word from the same content and the same page plan as
 * its PDF, so the two page and look alike: hidden branches left out and
 * worked-out answers printed exactly as the PDF prints them.
 *
 * @param input - Document snapshot, answers, workflow and signer state, as the PDF takes them.
 * @param options - Reads stored pictures' print copies.
 * @returns The .docx bytes.
 * @throws DocumentPdfServiceError when validation or rendering fails.
 */
export async function renderGeneratedDocumentDocx(
  input: RenderGeneratedDocumentPdfInput,
  options: { readImage?: PdfLibRenderContext["readImage"] } = {}
): Promise<Buffer> {
  return renderPlannedDocument("docx", "a Word document", input, {}, (normalized, pages) => renderDocxDocument(normalized, pages, options))
}
