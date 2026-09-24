import type { PDFImage } from "pdf-lib"

import {
  exceedsEmbeddedImageLimit,
  MAX_DOCUMENT_PNG_PIXELS,
  parseImageDataUrl,
  readImageDimensions,
} from "@/lib/image-header"

import { DocumentPdfServiceError } from "./errors"
import type { PdfLibRenderContext } from "./pdf-lib-types"

/**
 * Embeds and caches a PNG or JPEG data URL in the active PDF document.
 *
 * The header is read before pdf-lib sees the bytes. pdf-lib decodes every PNG
 * pixel into memory and keeps it until the PDF is saved, so a PNG over the
 * per-image limit, or one that would take this render past its PNG allowance,
 * is refused before anything is allocated. JPEGs are embedded as compressed
 * data and cost no decoding.
 *
 * @param context - Active pdf-lib render state.
 * @param dataUrl - PNG or JPEG data URL.
 * @returns Embedded pdf-lib image.
 * @throws DocumentPdfServiceError when the image is unreadable or too large.
 */
export async function embedPdfLibImage(
  context: PdfLibRenderContext,
  dataUrl: string
): Promise<PDFImage> {
  const cached = context.imageCache.get(dataUrl)

  if (cached) {
    return cached
  }

  const image = parseImageDataUrl(dataUrl)

  if (!image) {
    throw createInvalidImageError()
  }

  const bytes = Buffer.from(image.encoded, "base64")
  const dimensions = readImageDimensions(bytes, image.format)

  if (!dimensions) {
    throw createInvalidImageError()
  }

  if (exceedsEmbeddedImageLimit(image.format, dimensions)) {
    throw new DocumentPdfServiceError(
      "An embedded document image is too large.",
      400
    )
  }

  if (
    image.format === "png" &&
    countDecodedPngPixels(context.imageCache) +
      dimensions.width * dimensions.height >
      MAX_DOCUMENT_PNG_PIXELS
  ) {
    throw new DocumentPdfServiceError(
      "This document's images are too large to include in a PDF.",
      400
    )
  }

  try {
    const embedded =
      image.format === "png"
        ? await context.document.embedPng(bytes)
        : await context.document.embedJpg(bytes)
    context.imageCache.set(dataUrl, embedded)
    return embedded
  } catch {
    throw createInvalidImageError()
  }
}

/**
 * Scales a PDF image within a bounding box without enlarging it.
 *
 * @param image - Embedded pdf-lib image.
 * @param maximumWidth - Maximum rendered width.
 * @param maximumHeight - Maximum rendered height.
 * @returns Fitted image dimensions.
 */
export function fitPdfImage(
  image: PDFImage,
  maximumWidth: number,
  maximumHeight: number
): { height: number; width: number } {
  const scale = Math.min(
    maximumWidth / image.width,
    maximumHeight / image.height,
    1
  )

  return {
    height: image.height * scale,
    width: image.width * scale,
  }
}

// The render's cache holds every image decoded so far, once each, so its PNG
// entries are exactly the pixels this render has allocated.
function countDecodedPngPixels(
  imageCache: ReadonlyMap<string, PDFImage>
): number {
  let pixels = 0

  for (const [dataUrl, image] of imageCache) {
    if (dataUrl.startsWith("data:image/png;")) {
      pixels += image.width * image.height
    }
  }

  return pixels
}

function createInvalidImageError(): DocumentPdfServiceError {
  return new DocumentPdfServiceError(
    "An embedded document image is invalid.",
    400
  )
}
