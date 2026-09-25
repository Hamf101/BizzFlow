import type { PDFImage } from "pdf-lib"

import {
  exceedsEmbeddedImageLimit,
  MAX_DOCUMENT_PNG_PIXELS,
  parseImageDataUrl,
  readImageDimensions,
} from "@/lib/image-header"
import type { TemplateImageAsset } from "@/types/template"

import { DocumentPdfServiceError } from "./errors"
import type { PdfLibRenderContext } from "./pdf-lib-types"

/**
 * Embeds and caches a picture in the active PDF document: a stored picture's
 * print copy, or the data of one embedded before pictures were stored.
 *
 * The header is read before pdf-lib sees the bytes. pdf-lib decodes every PNG
 * pixel into memory and keeps it until the PDF is saved, so a PNG over the
 * per-image limit, or one that would take this render past its PNG allowance,
 * is refused before anything is allocated. JPEGs are embedded as compressed
 * data and cost no decoding.
 *
 * @param context - Active pdf-lib render state.
 * @param picture - An embedded PNG or JPEG data URL, such as a drawn
 *   signature, or a block or logo's stored or embedded picture.
 * @returns Embedded pdf-lib image.
 * @throws DocumentPdfServiceError when the image is unreadable or too large.
 */
export async function embedPdfLibImage(
  context: PdfLibRenderContext,
  picture: string | { asset?: TemplateImageAsset | null; dataUrl?: string | null }
): Promise<PDFImage> {
  const { asset, dataUrl } = typeof picture === "string" ? { asset: null, dataUrl: picture } : picture
  const cacheKey = asset ? `asset:${asset.id}` : (dataUrl ?? "")
  const cached = context.imageCache.get(cacheKey)

  if (cached) {
    return cached
  }

  const image = asset ? await readStoredImage(context, asset) : parseEmbeddedImage(dataUrl)

  if (!image) {
    throw createInvalidImageError()
  }

  const { bytes } = image
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
    context.imageCache.set(cacheKey, embedded)
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

type PdfImageBytes = { bytes: Buffer; format: "jpeg" | "png" }

function parseEmbeddedImage(dataUrl: string | null | undefined): PdfImageBytes | null {
  const image = dataUrl ? parseImageDataUrl(dataUrl) : null

  return image ? { bytes: Buffer.from(image.encoded, "base64"), format: image.format } : null
}

async function readStoredImage(
  context: PdfLibRenderContext,
  asset: TemplateImageAsset
): Promise<PdfImageBytes | null> {
  if (!context.readImage) {
    throw new DocumentPdfServiceError("This document's pictures could not be loaded.", 500)
  }

  const bytes = Buffer.from(await context.readImage(asset))
  // The print copy is a PNG or a JPEG; its first bytes say which.
  const format = bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpeg" : null

  return format ? { bytes, format } : null
}
