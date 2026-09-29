import { blockSpacingAdjustment, columnGap, type TemplatePageGeometry } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

import { PDF_CONTENT_WIDTH } from "./constants"

/** Resolved physical measurements shared by PDF planning and drawing. */
export type PdfLayoutMetrics = Readonly<{
  pageWidth: number
  pageHeight: number
  /** The left margin, where lines start. */
  margin: number
  marginBottom: number
  /** Line height as a multiple of the text size, when the layout sets one. */
  lineSpacing?: number
  contentWidth: number
  flowTopY: number
  pageCapacity: number
  columnGap: number
  densityItemGapAdjustment: number
}>

type RenderPlanGeometry = Pick<
  TemplatePageGeometry,
  "contentHeightPoints" | "contentWidthPoints" | "heightPoints" | "marginPoints" | "margins" | "widthPoints"
>

/**
 * Converts the canonical page geometry into concrete PDF measurements.
 *
 * The default A4 capacity remains the established 760-point flow so existing
 * snapshots paginate identically. Other page configurations use their exact
 * canonical printable height.
 *
 * @param geometry - Canonical physical page geometry.
 * @param layout - Canonical density and page policies.
 * @returns Measurements used by both the planner and pdf-lib adapter.
 */
export function createPdfLayoutMetrics(
  geometry: RenderPlanGeometry,
  layout: TemplateLayout
): PdfLayoutMetrics {
  return {
    pageWidth: geometry.widthPoints,
    pageHeight: geometry.heightPoints,
    margin: geometry.margins.left,
    marginBottom: geometry.margins.bottom,
    lineSpacing: layout.lineSpacing,
    contentWidth: geometry.contentWidthPoints,
    // The page's own margins, as the editor draws them.
    flowTopY: geometry.heightPoints - geometry.margins.top,
    pageCapacity: geometry.contentHeightPoints,
    columnGap: columnGap(geometry.contentWidthPoints),
    densityItemGapAdjustment: blockSpacingAdjustment(layout)
  }
}

/**
 * Scales a character-count wrapping estimate to the active content width.
 *
 * @param baselineCharacters - Estimate calibrated for the default A4 width.
 * @param availableWidth - Width available to the item being measured.
 * @returns A bounded width-aware character estimate.
 */
export function scalePdfCharacterEstimate(
  baselineCharacters: number,
  availableWidth: number
): number {
  return Math.max(
    4,
    Math.floor(baselineCharacters * (availableWidth / PDF_CONTENT_WIDTH))
  )
}

/**
 * Places the columns of a row: each gets its share of the content width, in
 * twelfths, after the gaps between them.
 *
 * @param metrics - Active PDF layout measurements.
 * @param widths - Each column's width in twelfths.
 * @returns Each column's left edge and width, left to right.
 */
export function getPdfColumnFrames(
  metrics: PdfLayoutMetrics,
  widths: readonly number[]
): Array<Readonly<{ x: number; width: number }>> {
  const shared = metrics.contentWidth - metrics.columnGap * (widths.length - 1)
  let x = metrics.margin

  return widths.map((twelfths: number) => {
    const frame = { width: (shared * twelfths) / 12, x }

    x += frame.width + metrics.columnGap

    return frame
  })
}
