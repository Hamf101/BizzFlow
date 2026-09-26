import type { PDFFont, PDFDocument, PDFImage, PDFPage } from "pdf-lib"

import type { TemplateImageAsset } from "@/types/template"

import type { NormalizedPdfInput } from "./types"
import type { PdfLayoutMetrics } from "./layout"

/** Shared state used while drawing one pdf-lib page. */
export type PdfLibRenderContext = {
  answers: Record<string, unknown>
  boldFont: PDFFont
  content: NormalizedPdfInput["content"]
  document: PDFDocument
  /** The face for bold or italic words; the slanted ones are embedded on first use. */
  faceFor: (bold: boolean, italic: boolean) => Promise<PDFFont>
  hasSigners: boolean
  imageCache: Map<string, PDFImage>
  layout: PdfLayoutMetrics
  page: PDFPage
  /** Reads a stored picture's print copy; documents with none never call it. */
  readImage?: (asset: TemplateImageAsset) => Promise<Uint8Array>
  regularFont: PDFFont
  workflowStatus: NormalizedPdfInput["workflowStatus"]
}
