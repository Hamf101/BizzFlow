/** Image formats a document can embed. */
export type EmbeddedImageFormat = "jpeg" | "png"

/** Pixel size an image header declares. */
export type ImageDimensions = {
  height: number
  width: number
}

/** A PNG or JPEG data URL split into its format and base64 payload. */
export type ImageDataUrlParts = {
  encoded: string
  format: EmbeddedImageFormat
}

/**
 * Most pixels one PNG may declare. PDF rendering decodes every PNG pixel into
 * memory, roughly 12–16 bytes each at the peak, so a small but highly
 * compressible file could otherwise demand gigabytes. Sixteen megapixels still
 * fits a 12 MP phone photo or a 5K screenshot.
 */
export const MAX_EMBEDDED_PNG_PIXELS = 16_000_000

/**
 * Most PNG pixels one document may decode across its images: four
 * maximum-size PNGs. Decoded pixels stay in memory until the PDF is saved.
 */
export const MAX_DOCUMENT_PNG_PIXELS = 64_000_000

/** Shown when an author picks or saves a PNG over the per-image limit. */
export const EMBEDDED_PNG_TOO_LARGE_MESSAGE =
  "PNG images can be up to 16 megapixels. Use a smaller image or a JPEG."

const IMAGE_DATA_URL_PARTS_PATTERN =
  /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_HEADER_CHUNK_TYPE = [0x49, 0x48, 0x44, 0x52]
// Signature, header chunk length and type, 13 header bytes, and checksum.
const PNG_HEADER_LENGTH = 33
const JPEG_START_OF_IMAGE = [0xff, 0xd8]

/**
 * Splits a PNG or JPEG base64 data URL without decoding it.
 *
 * @param value - Untrusted data URL.
 * @returns Its format and base64 payload, or null for anything else.
 */
export function parseImageDataUrl(value: string): ImageDataUrlParts | null {
  const match = IMAGE_DATA_URL_PARTS_PATTERN.exec(value)

  return match
    ? { encoded: match[2], format: match[1] as EmbeddedImageFormat }
    : null
}

/**
 * Reads the pixel size an image header declares, without decoding pixels.
 *
 * JPEG data after the end-of-image marker is ignored, as motion photos append
 * video there.
 *
 * @param bytes - Encoded image bytes.
 * @param format - Format the bytes claim to be.
 * @returns Declared dimensions, or null when the header is missing,
 *   malformed, or declares an empty image.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  format: EmbeddedImageFormat
): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dimensions =
    format === "png"
      ? readPngDimensions(bytes, view)
      : readJpegDimensions(bytes, view)

  return dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : null
}

/**
 * Tells whether one image is too large to embed in a document.
 *
 * Only PNGs are limited: PDFs embed JPEGs as compressed data, so a JPEG's
 * pixel count costs no decoding memory.
 *
 * @param format - Image format.
 * @param dimensions - Declared image dimensions.
 * @returns True when the image exceeds the per-image limit.
 */
export function exceedsEmbeddedImageLimit(
  format: EmbeddedImageFormat,
  dimensions: ImageDimensions
): boolean {
  return (
    format === "png" &&
    dimensions.width * dimensions.height > MAX_EMBEDDED_PNG_PIXELS
  )
}

function readPngDimensions(
  bytes: Uint8Array,
  view: DataView
): ImageDimensions | null {
  const hasHeader =
    bytes.length >= PNG_HEADER_LENGTH &&
    hasBytesAt(bytes, 0, PNG_SIGNATURE) &&
    view.getUint32(8) === 13 &&
    hasBytesAt(bytes, 12, PNG_HEADER_CHUNK_TYPE)

  return hasHeader
    ? { height: view.getUint32(20), width: view.getUint32(16) }
    : null
}

function readJpegDimensions(
  bytes: Uint8Array,
  view: DataView
): ImageDimensions | null {
  if (!hasBytesAt(bytes, 0, JPEG_START_OF_IMAGE)) {
    return null
  }

  let offset = 2

  while (offset < bytes.length - 1) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    // Any run of 0xff bytes pads the marker that follows it.
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1
    }

    const marker = bytes[offset]
    offset += 1

    // The image ends, or its scan data begins, before any frame header.
    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      return null
    }

    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue
    }

    if (offset + 2 > bytes.length) {
      return null
    }

    const segmentLength = view.getUint16(offset)

    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return null
    }

    if (isJpegStartOfFrameMarker(marker)) {
      return segmentLength < 7
        ? null
        : {
            height: view.getUint16(offset + 3),
            width: view.getUint16(offset + 5),
          }
    }

    offset += segmentLength
  }

  return null
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

function hasBytesAt(
  bytes: Uint8Array,
  offset: number,
  expected: readonly number[]
): boolean {
  return expected.every(
    (byte: number, index: number): boolean => bytes[offset + index] === byte
  )
}
