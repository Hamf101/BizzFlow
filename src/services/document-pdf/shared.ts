import { formatDateAnswer } from "@/lib/date-format"
import { createTemplateRenderPlan } from "@/services/templates/template-render-plan"
import {
  answerBoxHeight,
  parseTemplateContent,
  type TemplateBlock,
  type TemplateContent,
} from "@/types/template"

import {
  DRAWING_DATA_URL_PATTERN,
  MAX_DRAWING_DATA_URL_LENGTH,
} from "./constants"
import { DocumentPdfServiceError } from "./errors"
import type {
  NormalizedPdfInput,
  PdfFieldBlock,
  RenderGeneratedDocumentPdfInput,
} from "./types"

/**
 * Validates and normalizes untrusted generated-document PDF input.
 *
 * @param input - Document metadata, snapshot, answers, workflow, and signer state.
 * @returns Canonical PDF input with parsed template content and a signer array.
 * @throws DocumentPdfServiceError when any required value is invalid.
 */
export function normalizePdfInput(
  input: RenderGeneratedDocumentPdfInput
): NormalizedPdfInput {
  if (!input.documentId.trim()) {
    throw new DocumentPdfServiceError("Document id is required.", 400)
  }

  const title = input.title.trim()

  if (title.length === 0 || title.length > 180) {
    throw new DocumentPdfServiceError(
      "Document title must be between 1 and 180 characters.",
      400
    )
  }

  let content: TemplateContent

  try {
    content = parseTemplateContent(input.content)
  } catch {
    throw new DocumentPdfServiceError(
      "The document snapshot is invalid and cannot be rendered.",
      400
    )
  }

  if (!input.answers || typeof input.answers !== "object") {
    throw new DocumentPdfServiceError("Document answers are invalid.", 400)
  }

  const signers = input.signers ?? []
  const metadataTimestamp = normalizeMetadataTimestamp(
    input.metadataTimestamp
  )

  for (const signer of signers) {
    if (!signer.id.trim() || !signer.name.trim() || !signer.email.trim()) {
      throw new DocumentPdfServiceError("A signer record is invalid.", 400)
    }

    if (signer.signatureDataUrl) {
      normalizeRequiredDrawingDataUrl(signer.signatureDataUrl)
    }

    if (signer.initialsDataUrl) {
      normalizeRequiredDrawingDataUrl(signer.initialsDataUrl)
    }
  }

  return {
    ...input,
    title,
    content,
    renderPlan: createTemplateRenderPlan({
      title,
      content,
      answers: input.answers,
      mode: "final",
    }),
    metadataTimestamp,
    signers,
  }
}

/**
 * Validates and canonicalizes the optional timestamp written to PDF metadata.
 *
 * @param value - RFC 3339 timestamp supplied by immutable persistence metadata.
 * @returns A whole-second UTC timestamp, or `undefined` when metadata is omitted.
 * @throws DocumentPdfServiceError when a supplied timestamp is malformed.
 */
function normalizeMetadataTimestamp(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const isTimestamp =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  const timestamp = new Date(value)

  if (!isTimestamp || Number.isNaN(timestamp.getTime())) {
    throw new DocumentPdfServiceError(
      "PDF metadata timestamp is invalid.",
      400
    )
  }

  // PDF date strings have whole-second precision; normalize before rendering so
  // the in-memory input and serialized metadata describe the same instant.
  timestamp.setUTCMilliseconds(0)
  return timestamp.toISOString()
}

/**
 * Formats one stored field answer for printable output.
 *
 * @param block - Canonical fillable template block.
 * @param value - Stored answer value for the block.
 * @returns Bounded, human-readable field text.
 */
export function formatFieldValue(
  block: PdfFieldBlock,
  value: unknown
): string {
  if (block.type === "file_field") {
    return "Uploads are only in submissions."
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const text = value.trim().slice(0, 20_000)

    return block.type === "date_field" ? formatDateAnswer(text, block.dateFormat) : text
  }

  // Left empty, so the printed box is there to write in.
  return ""
}

/**
 * Whether a checkbox prints ticked: its answer, or its default when unanswered.
 *
 * @param block - The checkbox.
 * @param value - Its stored answer.
 * @returns Whether to draw a tick.
 */
export function isFieldChecked(block: Extract<PdfFieldBlock, { type: "checkbox_field" }>, value: unknown): boolean {
  return value === undefined ? block.checkedByDefault : value === true
}

// The page shows answer boxes at these heights too, so they live with the blocks.
export { answerBoxHeight } from "@/types/template"
/** The gap between an answer box's edge and its text, in points. */
export const ANSWER_BOX_PADDING = 6
/** How far a checkbox's label sits from the box's left edge, in points. */
export const CHECKBOX_LABEL_INSET = 16

/** What a signature or initials field prints in its room when signers sign in the signing record. */
export const SIGNER_NOTE = "Captured per signer in signing record below"

/**
 * The room a signature or initials field leaves to sign in: its box, taller
 * when a drawing already made goes in it.
 *
 * @param block - The signature or initials field.
 * @param hasDrawing - Whether a drawing is printed in it.
 * @returns The room's height, in points.
 */
export function drawingRoom(block: TemplateBlock, hasDrawing: boolean): number {
  return hasDrawing ? Math.max(answerBoxHeight(block), 45 + ANSWER_BOX_PADDING * 2) : answerBoxHeight(block)
}

// The field styles' measurements, in points; the editor draws them alike.
/** The space under a field: 3 above its help, 7 after. */
export const FIELD_GAP_BELOW = 10
/** The weight of an answer's line and a cell's edge; touching cells overlap by it, so they share one edge. */
export const FIELD_RULE_WIDTH = 0.7
/** Line style: the most of a field's width its label takes beside the line. */
export const LINE_LABEL_SHARE = 0.45
/** Line style: the space between a label and its line. */
export const LINE_LABEL_GAP = 6
/** Line style: how far the line sits under the band of text it is written on. */
export const LINE_RULE_DROP = 2
/** Line style: the space between the ruled lines of a long answer. */
export const RULED_LINE_PITCH = 20
/** Line style: how far a long answer's text sits above its ruled line. */
export const RULED_TEXT_RISE = 5
/** Line style: the gap between a signature's line and its caption. */
export const CAPTION_GAP = 2
/** Line style: a signature caption's text size and line height. */
export const CAPTION_SIZE = 8
export const CAPTION_LEADING = 11
/** Cell style: the space inside a cell's outer edge. */
export const CELL_PADDING = 4
/** Cell style: a cell's label's text size and line height. */
export const CELL_LABEL_SIZE = 7
export const CELL_LABEL_LEADING = 10
/** Cell style: the gap between a cell's label and its answer. */
export const CELL_LABEL_GAP = 2

/** A field the layout's field style draws; a checkbox, radio buttons and an upload print as they always do. */
export type StyledFieldBlock = Extract<TemplateBlock, { type: "date_field" | "dropdown_field" | "initials_field" | "signature_field" | "text_field" }>

/**
 * Whether a field takes the layout's field style.
 *
 * @param block - Any block.
 * @returns True for a text, date, dropdown, signature or initials field; not radio buttons.
 */
export function isStyledField(block: TemplateBlock): block is StyledFieldBlock {
  return (
    block.type === "text_field" ||
    block.type === "date_field" ||
    block.type === "signature_field" ||
    block.type === "initials_field" ||
    (block.type === "dropdown_field" && block.display !== "radios")
  )
}

/**
 * Whether a row prints as cells that touch: the cell style, and every block in
 * it a styled field.
 *
 * @param cells - The row's blocks, left to right; null where a column is empty.
 * @param style - The layout's field style.
 * @returns True when the row's cells share their edges.
 */
export function isCellRow(cells: readonly ({ block: TemplateBlock } | null | undefined)[], style: string): boolean {
  return style === "cell" && isStyledRow(cells)
}

/**
 * Whether every block in a row is a styled field, so its fields line up as one:
 * cells that touch, or lines on one level.
 *
 * @param cells - The row's blocks, left to right; null where a column is empty.
 * @returns True for a row with at least one block, all of them styled fields.
 */
export function isStyledRow(cells: readonly ({ block: TemplateBlock } | null | undefined)[]): boolean {
  return cells.some(Boolean) && cells.every((cell) => !cell || isStyledField(cell.block))
}

/** The space between radio buttons set side by side. */
export const RADIO_ACROSS_GAP = 18

/**
 * Sets radio options side by side in lines no wider than the room, in order.
 * An option too wide to share a line takes one of its own.
 *
 * @param options - The options, in order.
 * @param width - The width of a line.
 * @param measure - An option's width, its circle included.
 * @returns The options on each line.
 */
export function packRadioOptions(options: readonly string[], width: number, measure: (option: string) => number): string[][] {
  const lines: string[][] = []
  let used = width

  for (const option of options) {
    const size = measure(option)

    if (used + RADIO_ACROSS_GAP + size > width) {
      lines.push([option])
      used = size
    } else {
      lines[lines.length - 1].push(option)
      used += RADIO_ACROSS_GAP + size
    }
  }

  return lines
}

/**
 * Reads an optional drawing data URL from supported answer shapes.
 *
 * @param value - Raw answer value or object containing a data URL.
 * @returns A validated drawing URL, or null when no drawing exists.
 * @throws DocumentPdfServiceError when a present drawing is malformed.
 */
export function normalizeDrawingDataUrl(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return normalizeRequiredDrawingDataUrl(value)
  }

  if (
    value &&
    typeof value === "object" &&
    "dataUrl" in value &&
    typeof value.dataUrl === "string"
  ) {
    return normalizeRequiredDrawingDataUrl(value.dataUrl)
  }

  return null
}

/**
 * Validates a required PNG or JPEG signature drawing data URL.
 *
 * @param value - Encoded drawing data URL.
 * @returns The validated drawing data URL.
 * @throws DocumentPdfServiceError when the data URL is malformed or oversized.
 */
export function normalizeRequiredDrawingDataUrl(value: string): string {
  if (
    value.length > MAX_DRAWING_DATA_URL_LENGTH ||
    !DRAWING_DATA_URL_PATTERN.test(value)
  ) {
    throw new DocumentPdfServiceError(
      "A signature or initials drawing is invalid.",
      400
    )
  }

  return value
}

/**
 * Formats a valid signer timestamp for the signing record.
 *
 * @param value - ISO-compatible signer timestamp.
 * @returns Stable UTC timestamp text.
 * @throws DocumentPdfServiceError when the timestamp is invalid.
 */
export function formatSignedAt(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new DocumentPdfServiceError("A signer timestamp is invalid.", 400)
  }

  return date.toISOString().replace("T", " ").replace(".000Z", " UTC")
}
