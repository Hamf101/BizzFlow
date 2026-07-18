import type { PDFFont, PDFDocument, PDFImage, PDFPage } from "pdf-lib"

import type { NormalizedPdfInput } from "./types"

/** Shared state used while drawing one pdf-lib page. */
export type PdfLibRenderContext = {
  answers: Record<string, unknown>
  boldFont: PDFFont
  content: NormalizedPdfInput["content"]
  document: PDFDocument
  hasSigners: boolean
  imageCache: Map<string, PDFImage>
  page: PDFPage
  regularFont: PDFFont
  workflowStatus: NormalizedPdfInput["workflowStatus"]
}
