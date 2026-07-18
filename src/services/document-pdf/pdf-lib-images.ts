import type { PDFImage } from "pdf-lib"

import { DocumentPdfServiceError } from "./errors"
import type { PdfLibRenderContext } from "./pdf-lib-types"

/**
 * Embeds and caches a PNG or JPEG data URL in the active PDF document.
 *
 * @param context - Active pdf-lib render state.
 * @param dataUrl - Valid image data URL.
 * @returns Embedded pdf-lib image.
 * @throws DocumentPdfServiceError when the image cannot be decoded.
 */
export async function embedPdfLibImage(
  context: PdfLibRenderContext,
  dataUrl: string
): Promise<PDFImage> {
  const cached = context.imageCache.get(dataUrl)

  if (cached) {
    return cached
  }

  const separatorIndex = dataUrl.indexOf(",")

  if (separatorIndex < 0) {
    throw new DocumentPdfServiceError(
      "An embedded document image is invalid.",
      400
    )
  }

  const bytes = Buffer.from(dataUrl.slice(separatorIndex + 1), "base64")

  try {
    const image = dataUrl.startsWith("data:image/png")
      ? await context.document.embedPng(bytes)
      : await context.document.embedJpg(bytes)
    context.imageCache.set(dataUrl, image)
    return image
  } catch {
    throw new DocumentPdfServiceError(
      "An embedded document image is invalid.",
      400
    )
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
