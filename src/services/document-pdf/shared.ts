import {
  parseTemplateContent,
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
    return "File uploads are available only in internal submissions."
  }

  if (block.type === "checkbox_field") {
    const checked = value === undefined ? block.checkedByDefault : value === true
    return checked ? "Checked" : "Not checked"
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().slice(0, 20_000)
  }

  return "Not completed"
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
