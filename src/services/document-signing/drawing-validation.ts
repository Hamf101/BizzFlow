import { PDFDocument } from "pdf-lib"

import {
  parseImageDataUrl,
  readImageDimensions,
  type EmbeddedImageFormat,
} from "@/lib/image-header"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"

const MAX_DRAWING_DATA_URL_LENGTH = 2_800_000
const MIN_DRAWING_IMAGE_WIDTH = 16
const MIN_DRAWING_IMAGE_HEIGHT = 8
const MAX_DRAWING_IMAGE_DIMENSION = 4_096
const MAX_DRAWING_IMAGE_PIXELS = 4_194_304

/** Validated drawing shape stored in signing records. */
export type DrawingData = { dataUrl: string }

type DrawingImageMetadata = {
  bytes: Buffer
  format: EmbeddedImageFormat
  height: number
  width: number
}

/**
 * Validates a required PNG or JPEG drawing.
 *
 * @param value - Untrusted signature or initials data URL.
 * @param label - User-facing drawing label used in safe error messages.
 * @returns Validated drawing persistence value.
 * @throws DocumentSigningServiceError when the drawing is absent or invalid.
 */
export async function normalizeRequiredDrawing(
  value: unknown,
  label: string
): Promise<DrawingData> {
  const drawing = await normalizeOptionalDrawing(value, label)

  if (!drawing) {
    throw new DocumentSigningServiceError(
      `A drawn ${label.toLowerCase()} is required.`,
      400
    )
  }

  return drawing
}

/**
 * Validates an optional PNG or JPEG drawing and its image dimensions.
 *
 * @param value - Untrusted signature or initials data URL.
 * @param label - User-facing drawing label used in safe error messages.
 * @returns Validated drawing, or `null` when no drawing was supplied.
 * @throws DocumentSigningServiceError when supplied drawing data is invalid.
 */
export async function normalizeOptionalDrawing(
  value: unknown,
  label: string
): Promise<DrawingData | null> {
  if (value === null || value === undefined || value === "") {
    return null
  }

  if (typeof value !== "string" || value.length > MAX_DRAWING_DATA_URL_LENGTH) {
    throw createInvalidDrawingError(label)
  }

  const metadata = decodeDrawingImage(value, label)

  try {
    const pdfDocument = await PDFDocument.create()

    if (metadata.format === "png") {
      await pdfDocument.embedPng(metadata.bytes)
    } else {
      await pdfDocument.embedJpg(metadata.bytes)
    }
  } catch {
    throw createInvalidDrawingError(label)
  }

  return { dataUrl: value }
}

/**
 * Reads a safe drawing data URL from persisted JSON.
 *
 * @param value - Stored signature or initials JSON.
 * @returns Safe PNG/JPEG data URL, or `null` for malformed stored data.
 */
export function getDrawingDataUrl(
  value: Record<string, unknown> | null
): string | null {
  if (!value || typeof value.dataUrl !== "string") {
    return null
  }

  if (
    value.dataUrl.length > MAX_DRAWING_DATA_URL_LENGTH ||
    !parseImageDataUrl(value.dataUrl)
  ) {
    return null
  }

  return value.dataUrl
}

function decodeDrawingImage(value: string, label: string): DrawingImageMetadata {
  const image = parseImageDataUrl(value)

  if (!image || image.encoded.length % 4 !== 0) {
    throw createInvalidDrawingError(label)
  }

  const bytes = Buffer.from(image.encoded, "base64")

  if (bytes.length === 0 || bytes.toString("base64") !== image.encoded) {
    throw createInvalidDrawingError(label)
  }

  // A drawing is a complete canvas export, so a JPEG must also end cleanly.
  const dimensions =
    image.format === "jpeg" && !endsWithJpegEndMarker(bytes)
      ? null
      : readImageDimensions(bytes, image.format)

  if (!dimensions) {
    throw createInvalidDrawingError(label)
  }

  assertDrawingDimensions(dimensions.width, dimensions.height, label)
  return { bytes, format: image.format, ...dimensions }
}

function endsWithJpegEndMarker(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  )
}

function assertDrawingDimensions(
  width: number,
  height: number,
  label: string
): void {
  if (
    width < MIN_DRAWING_IMAGE_WIDTH ||
    height < MIN_DRAWING_IMAGE_HEIGHT ||
    width > MAX_DRAWING_IMAGE_DIMENSION ||
    height > MAX_DRAWING_IMAGE_DIMENSION ||
    width * height > MAX_DRAWING_IMAGE_PIXELS
  ) {
    throw createInvalidDrawingError(label)
  }
}

function createInvalidDrawingError(label: string): DocumentSigningServiceError {
  return new DocumentSigningServiceError(
    `The drawn ${label.toLowerCase()} is invalid.`,
    400
  )
}
