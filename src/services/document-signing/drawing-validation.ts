import { PDFDocument } from "pdf-lib"

import { DocumentSigningServiceError } from "@/services/document-signing/errors"

const MAX_DRAWING_DATA_URL_LENGTH = 2_800_000
const MIN_DRAWING_IMAGE_WIDTH = 16
const MIN_DRAWING_IMAGE_HEIGHT = 8
const MAX_DRAWING_IMAGE_DIMENSION = 4_096
const MAX_DRAWING_IMAGE_PIXELS = 4_194_304
const DRAWING_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/

/** Validated drawing shape stored in signing records. */
export type DrawingData = { dataUrl: string }

type DrawingImageFormat = "jpeg" | "png"

type DrawingImageMetadata = {
  bytes: Buffer
  format: DrawingImageFormat
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
    !DRAWING_DATA_URL_PATTERN.test(value.dataUrl)
  ) {
    return null
  }

  return value.dataUrl
}

function decodeDrawingImage(value: string, label: string): DrawingImageMetadata {
  const match = DRAWING_DATA_URL_PATTERN.exec(value)

  if (!match) {
    throw createInvalidDrawingError(label)
  }

  const format = match[1] as DrawingImageFormat
  const encodedBytes = match[2]

  if (encodedBytes.length % 4 !== 0) {
    throw createInvalidDrawingError(label)
  }

  const bytes = Buffer.from(encodedBytes, "base64")

  if (bytes.length === 0 || bytes.toString("base64") !== encodedBytes) {
    throw createInvalidDrawingError(label)
  }

  const dimensions =
    format === "png"
      ? readPngDimensions(bytes, label)
      : readJpegDimensions(bytes, label)

  assertDrawingDimensions(dimensions.width, dimensions.height, label)
  return { bytes, format, ...dimensions }
}

function readPngDimensions(
  bytes: Buffer,
  label: string
): Pick<DrawingImageMetadata, "height" | "width"> {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const hasValidHeader =
    bytes.length >= 33 &&
    bytes.subarray(0, pngSignature.length).equals(pngSignature) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR"

  if (!hasValidHeader) {
    throw createInvalidDrawingError(label)
  }

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function readJpegDimensions(
  bytes: Buffer,
  label: string
): Pick<DrawingImageMetadata, "height" | "width"> {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw createInvalidDrawingError(label)
  }

  let offset = 2

  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }

    const marker = bytes[offset]
    offset += 1

    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue
    }

    if (offset + 2 > bytes.length) {
      throw createInvalidDrawingError(label)
    }

    const segmentLength = bytes.readUInt16BE(offset)

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw createInvalidDrawingError(label)
    }

    if (isJpegStartOfFrameMarker(marker)) {
      if (segmentLength < 7) {
        throw createInvalidDrawingError(label)
      }

      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      }
    }

    offset += segmentLength
  }

  throw createInvalidDrawingError(label)
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
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
