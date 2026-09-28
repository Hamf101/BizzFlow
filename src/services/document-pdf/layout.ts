import type { TemplatePageGeometry } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

import {
  A4_HEIGHT,
  A4_WIDTH,
  PAGE_FLOW_HEIGHT,
  PAGE_HORIZONTAL_MARGIN,
  PAGE_TOP_MARGIN,
  PDF_CONTENT_WIDTH
} from "./constants"

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
  const isLegacyDefaultGeometry =
    !layout.margins &&
    approximatelyEqual(geometry.widthPoints, A4_WIDTH) &&
    approximatelyEqual(geometry.heightPoints, A4_HEIGHT) &&
    approximatelyEqual(geometry.marginPoints, PAGE_HORIZONTAL_MARGIN)

  return {
    pageWidth: geometry.widthPoints,
    pageHeight: geometry.heightPoints,
    margin: geometry.margins.left,
    marginBottom: geometry.margins.bottom,
    lineSpacing: layout.lineSpacing,
    contentWidth: geometry.contentWidthPoints,
    flowTopY: isLegacyDefaultGeometry
      ? geometry.heightPoints - PAGE_TOP_MARGIN
      : geometry.heightPoints - geometry.margins.top,
    pageCapacity: isLegacyDefaultGeometry
      ? PAGE_FLOW_HEIGHT
      : geometry.contentHeightPoints,
    columnGap: Math.min(16, Math.max(10, geometry.contentWidthPoints * 0.025)),
    // A paragraph already leaves 8pt below itself.
    densityItemGapAdjustment:
      layout.paragraphSpacing !== undefined
        ? layout.paragraphSpacing - 8
        : layout.density === "compact"
          ? -3
          : layout.density === "comfortable"
            ? 4
            : 0
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
 * Returns the printable width of one column in a two-column field group.
 *
 * @param metrics - Active PDF layout measurements.
 * @returns Width available to each column.
 */
export function getPdfColumnWidth(metrics: PdfLayoutMetrics): number {
  return (metrics.contentWidth - metrics.columnGap) / 2
}

// Paper sizes are rounded to the point, so A4 scaled to A3 and back lands a
// tenth of a point off; a quarter point still means the same page.
function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.25
}
