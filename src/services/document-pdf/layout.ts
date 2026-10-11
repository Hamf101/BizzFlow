import {
  blockSpacingAdjustment,
  columnGap,
  SECTION_BOX_EDGE,
  SECTION_BOX_GAP,
  SECTION_BOX_INSET,
  type TemplatePageGeometry
} from "@/services/templates/template-render-plan"
import type { TemplateBlock, TemplateLayout } from "@/types/template"

import { PDF_CONTENT_WIDTH } from "./constants"
import { FIELD_RULE_WIDTH, isCellRow } from "./shared"

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
  /** How answers print: in a box, on a line, or in a cell. */
  fieldStyle: NonNullable<TemplateLayout["fieldStyle"]>
  /** How a section's title prints: as a heading, in a bar, or atop a box around the section. */
  sectionStyle: NonNullable<TemplateLayout["sectionStyle"]>
}>

// The box's measurements, which the editor draws too.
export { SECTION_BOX_EDGE, SECTION_BOX_GAP, SECTION_BOX_INSET }

/**
 * The measurements a boxed section's blocks are laid out in: the box's inside,
 * an inset narrower each side, on a page that holds less by the box's top,
 * foot and the space under it.
 *
 * @param metrics - The page's measurements.
 * @returns The measurements inside the box.
 */
export function boxedPdfMetrics(metrics: PdfLayoutMetrics): PdfLayoutMetrics {
  return {
    ...metrics,
    contentWidth: metrics.contentWidth - SECTION_BOX_INSET * 2,
    margin: metrics.margin + SECTION_BOX_INSET,
    pageCapacity: metrics.pageCapacity - SECTION_BOX_INSET * 2 - SECTION_BOX_GAP
  }
}

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
    densityItemGapAdjustment: blockSpacingAdjustment(layout),
    fieldStyle: layout.fieldStyle ?? "box",
    sectionStyle: layout.sectionStyle ?? "plain"
  }
}

const LIST_LEVEL_INDENT = 18
// Room for a number as wide as 12.12 or (viii) before an item's words.
const LIST_NUMBER_HANG = 26

/**
 * Where a list item's marker and words start, from the left of its frame:
 * each level down is set in by a further 18 points, and the words hang clear
 * of the marker, so a long item wraps under its words, not its number. The
 * planner measures the words in the width the renderer draws them in.
 *
 * @param type - The list's type.
 * @param level - How far the item is set in, 0 at the margin.
 * @returns The marker's and the words' insets.
 */
export function listItemInset(type: "bullet_list" | "numbered_list", level: number): { marker: number; words: number } {
  const marker = 12 + level * LIST_LEVEL_INDENT

  return { marker, words: marker + (type === "bullet_list" ? 10 : LIST_NUMBER_HANG) }
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
 * @param gap - The space between columns; negative to overlap them.
 * @returns Each column's left edge and width, left to right.
 */
export function getPdfColumnFrames(
  metrics: PdfLayoutMetrics,
  widths: readonly number[],
  gap: number = metrics.columnGap
): Array<Readonly<{ x: number; width: number }>> {
  const shared = metrics.contentWidth - gap * (widths.length - 1)
  let x = metrics.margin

  return widths.map((twelfths: number) => {
    const frame = { width: (shared * twelfths) / 12, x }

    x += frame.width + gap

    return frame
  })
}

/**
 * Places a printed row's columns: cells that touch overlap by their edge, so
 * neighbours share one; anything else keeps the usual gap.
 *
 * @param metrics - Active PDF layout measurements.
 * @param row - The row's column widths and blocks.
 * @returns Each column's left edge and width, left to right.
 */
export function getPdfRowFrames(
  metrics: PdfLayoutMetrics,
  row: Readonly<{ cells: readonly ({ block: TemplateBlock } | null)[]; widths: readonly number[] }>
): Array<Readonly<{ x: number; width: number }>> {
  return getPdfColumnFrames(metrics, row.widths, isCellRow(row.cells, metrics.fieldStyle) ? -FIELD_RULE_WIDTH : metrics.columnGap)
}

/** Leading of a signer's bold 10-point name in the signing record. */
export const SIGNER_NAME_LEADING = 13

/**
 * The width a signer's name wraps in: the card's inside, less its signature
 * (88) and initials (48) and the 10-point gap left of each.
 */
export function signerNameWidth(
  signer: Readonly<{ initialsDataUrl?: string | null; signatureDataUrl?: string | null }>,
  contentWidth: number
): number {
  return contentWidth - 14 - (signer.signatureDataUrl ? 98 : 0) - (signer.initialsDataUrl ? 58 : 0)
}
