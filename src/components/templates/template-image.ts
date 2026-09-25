import { uploadFileToSignedUrl } from "@/components/documents/document-upload-client"
import { EMBEDDED_PNG_TOO_LARGE_MESSAGE, exceedsEmbeddedImageLimit } from "@/lib/image-header"
import type { TemplateImageAsset } from "@/types/template"
import { DISPLAY_MAX_EDGE, IMAGE_COPY_MAX_BYTES, type ImageCopy, PRINT_MAX_WIDTH } from "@/types/template-images"

type CopySpec = { bytes: number; contentType: "image/jpeg" | "image/png" | "image/webp" }

/** What the server needs to make room for a picture. */
export type ImageUploadRequest = {
  copies: Record<ImageCopy, CopySpec>
  height: number
  type: TemplateImageAsset["type"]
  width: number
}

/** The stored picture and where to upload each of its copies, or why not. */
export type ImageUploadGrant =
  | { asset: TemplateImageAsset; uploads: { contentType: string; copy: ImageCopy; url: string }[] }
  | { error: string }

/**
 * Stores a picture the author chose: the original as it is, a lighter copy
 * that pages show, and a copy sized for print and drawn the right way up. A
 * page then loads a few hundred kilobytes rather than the whole photo, and
 * the document itself keeps only a short reference.
 *
 * @param file - The chosen PNG or JPEG.
 * @param requestUpload - Asks the server for the picture's id and upload links.
 * @returns The stored picture, with the address this page can show it at.
 * @throws Error with a message for the author when the picture can't be stored.
 */
export async function storeTemplateImage(
  file: File,
  requestUpload: (request: ImageUploadRequest) => Promise<ImageUploadGrant>
): Promise<TemplateImageAsset> {
  const type = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpeg" : null

  if (!type) {
    throw new Error("Choose a PNG or JPEG image.")
  }

  if (file.size > IMAGE_COPY_MAX_BYTES.original) {
    throw new Error("Choose a picture under 20 MB.")
  }

  const bitmap = await createImageBitmap(file).catch((): never => {
    throw new Error("That picture couldn't be read.")
  })

  try {
    const { height, width } = bitmap
    const printSize = scaled(width, height, PRINT_MAX_WIDTH / width)

    if (exceedsEmbeddedImageLimit(type, printSize)) {
      throw new Error(EMBEDDED_PNG_TOO_LARGE_MESSAGE)
    }

    const copies = {
      display: await drawCopy(bitmap, scaled(width, height, DISPLAY_MAX_EDGE / Math.max(width, height)), type, "image/webp"),
      original: file,
      print: await drawCopy(bitmap, printSize, type, type === "png" ? "image/png" : "image/jpeg"),
    }
    const grant = await requestUpload({
      copies: {
        display: describe(copies.display),
        original: { bytes: file.size, contentType: file.type as CopySpec["contentType"] },
        print: describe(copies.print),
      },
      height,
      type,
      width,
    })

    if ("error" in grant) {
      throw new Error(grant.error)
    }

    await Promise.all(
      grant.uploads.map((upload) =>
        uploadFileToSignedUrl(upload.url, copies[upload.copy], "The picture couldn't be uploaded. Try again.", upload.contentType)
      )
    )

    return grant.asset
  } finally {
    bitmap.close()
  }
}

function scaled(width: number, height: number, factor: number): { height: number; width: number } {
  const fit = Math.min(1, factor)

  return { height: Math.max(1, Math.round(height * fit)), width: Math.max(1, Math.round(width * fit)) }
}

async function drawCopy(
  bitmap: ImageBitmap,
  size: { height: number; width: number },
  source: TemplateImageAsset["type"],
  contentType: CopySpec["contentType"]
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("That picture couldn't be prepared.")
  }

  context.imageSmoothingQuality = "high"
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  const blob = await encode(canvas, contentType)

  // A browser that can't write WebP hands back PNG; a photo is lighter as JPEG.
  return contentType === "image/webp" && blob.type !== "image/webp" && source === "jpeg"
    ? encode(canvas, "image/jpeg")
    : blob
}

function encode(canvas: HTMLCanvasElement, contentType: CopySpec["contentType"]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("That picture couldn't be prepared."))),
      contentType,
      contentType === "image/png" ? undefined : 0.88
    )
  })
}

function describe(blob: Blob): CopySpec {
  return { bytes: blob.size, contentType: blob.type as CopySpec["contentType"] }
}
