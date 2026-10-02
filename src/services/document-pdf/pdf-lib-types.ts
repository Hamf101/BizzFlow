import type { PDFFont, PDFDocument, PDFImage, PDFPage } from "pdf-lib"

import type { TemplateBlock, TemplateImageAsset } from "@/types/template"

import type { NormalizedPdfInput } from "./types"
import type { PdfLayoutMetrics } from "./layout"

/** Shared state used while drawing one pdf-lib page. */
export type PdfLibRenderContext = {
  answers: Record<string, unknown>
  boldFont: PDFFont
  content: NormalizedPdfInput["content"]
  document: PDFDocument
  /**
   * The face for bold or italic words, in the family they chose or the
   * default one; each face is embedded on first use.
   */
  faceFor: (bold: boolean, italic: boolean, font?: string, character?: string) => Promise<PDFFont>
  /** Pictures placed on a page rather than in the flow, printed over it. */
  /** The whole regular face, for a fillable PDF's form fields; absent in a PDF to print. */
  formFont?: PDFFont
  freeImages: Array<Extract<TemplateBlock, { type: "image" }>>
  hasSigners: boolean
  imageCache: Map<string, PDFImage>
  layout: PdfLayoutMetrics
  page: PDFPage
  /** Reads a stored picture's print copy; documents with none never call it. */
  readImage?: (asset: TemplateImageAsset) => Promise<Uint8Array>
  regularFont: PDFFont
  workflowStatus: NormalizedPdfInput["workflowStatus"]
}
