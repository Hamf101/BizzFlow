import {
  IMAGE_DATA_URL_PATTERN,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "@/types/template"

const ALLOWED_IMAGE_TYPES = new Set<string>(["image/png", "image/jpeg"])

/**
 * Reads a PNG or JPEG as a canonical data URL after enforcing the schema cap.
 *
 * @param file - Browser-selected image file.
 * @returns A validated base64 PNG or JPEG data URL.
 * @throws Error when the MIME type, encoded length, or data URL format is invalid.
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

  if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
    throw new Error("The selected image could not be validated.")
  }

  return dataUrl
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
