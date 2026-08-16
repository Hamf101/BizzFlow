import type { PDFFont, PDFDocument, PDFImage, PDFPage } from "pdf-lib"

import type { NormalizedPdfInput } from "./types"
import type { PdfLayoutMetrics } from "./layout"

/** Shared state used while drawing one pdf-lib page. */
export type PdfLibRenderContext = {
  answers: Record<string, unknown>
  boldFont: PDFFont
  content: NormalizedPdfInput["content"]
  document: PDFDocument
  hasSigners: boolean
  imageCache: Map<string, PDFImage>
  layout: PdfLayoutMetrics
  page: PDFPage
  regularFont: PDFFont
  workflowStatus: NormalizedPdfInput["workflowStatus"]
}
