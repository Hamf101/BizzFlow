import {
  EMBEDDED_PNG_TOO_LARGE_MESSAGE,
  exceedsEmbeddedImageLimit,
  parseImageDataUrl,
  readImageDimensions,
} from "@/lib/image-header"
import { MAX_IMAGE_DATA_URL_LENGTH } from "@/types/template"

const ALLOWED_IMAGE_TYPES = new Set<string>(["image/png", "image/jpeg"])

/**
 * Reads a PNG or JPEG as a canonical data URL after enforcing the schema cap.
 *
 * @param file - Browser-selected image file.
 * @returns A validated base64 PNG or JPEG data URL.
 * @throws Error when the MIME type, encoded length, data URL format, or image
 *   header is invalid, or when a PNG is too large for documents to render.
 */
export async function readTemplateImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG or JPEG image.")
  }

  const encodedLength =
    Math.ceil(file.size / 3) * 4 + `data:${file.type};base64,`.length

  if (encodedLength > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("The encoded image is too large for a template.")
  }

  const dataUrl = await readFileAsDataUrl(file)

  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new Error("The encoded image is too large for a template.")
  }

  const image = parseImageDataUrl(dataUrl)
  const dimensions = image
    ? readImageDimensions(decodeBase64(image.encoded), image.format)
    : null

  if (!image || !dimensions) {
    throw new Error("The selected image could not be validated.")
  }

  if (exceedsEmbeddedImageLimit(image.format, dimensions)) {
    throw new Error(EMBEDDED_PNG_TOO_LARGE_MESSAGE)
  }

  return dataUrl
}

function decodeBase64(encoded: string): Uint8Array {
  return Uint8Array.from(
    atob(encoded),
    (character: string): number => character.charCodeAt(0)
  )
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject): void => {
    const reader = new FileReader()

    reader.onerror = (): void => {
      reject(new Error("The selected image could not be read."))
    }
    reader.onload = (): void => {
      if (typeof reader.result !== "string") {
        reject(new Error("The selected image could not be read."))
        return
      }

      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
