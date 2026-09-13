import { PDFDocument, type PDFImage } from "pdf-lib"
import { describe, expect, it, vi, type Mock } from "vitest"

import {
  createJpegBytes,
  createPngBytes,
  createPngHeaderBytes,
  toImageDataUrl,
} from "@/lib/image-header.test-support"
import { embedPdfLibImage } from "@/services/document-pdf/pdf-lib-images"
import type { PdfLibRenderContext } from "@/services/document-pdf/pdf-lib-types"

const PHONE_PHOTO = toImageDataUrl("jpeg", createJpegBytes(8_000, 6_000))

type StubRender = {
  context: PdfLibRenderContext
  embedJpg: Mock<() => Promise<PDFImage>>
  embedPng: Mock<(bytes: Uint8Array) => Promise<PDFImage>>
}

describe("embedPdfLibImage", () => {
  it("refuses a PNG over 16 megapixels without decoding it", async () => {
    const render = createStubRender()

    await expect(
      embedPdfLibImage(render.context, createPngDataUrl(4_001, 4_000))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "An embedded document image is too large.",
    })
    expect(render.embedPng).not.toHaveBeenCalled()
  })

  it("refuses an image whose header cannot be read, without decoding it", async () => {
    const render = createStubRender()

    for (const dataUrl of [
      "data:image/png;base64,aGVsbG8=",
      "data:image/jpeg;base64,aGVsbG8=",
    ]) {
      await expect(embedPdfLibImage(render.context, dataUrl)).rejects.toMatchObject({
        statusCode: 400,
        message: "An embedded document image is invalid.",
      })
    }
    expect(render.embedPng).not.toHaveBeenCalled()
    expect(render.embedJpg).not.toHaveBeenCalled()
  })

  it("decodes PNGs until one render has decoded 64 megapixels", async () => {
    const render = createStubRender()
    const images = [1, 2, 3, 4, 5].map((salt: number): string =>
      createPngDataUrl(4_000, 4_000, salt)
    )

    for (const dataUrl of images.slice(0, 4)) {
      await embedPdfLibImage(render.context, dataUrl)
    }

    await expect(
      embedPdfLibImage(render.context, images[4])
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "This document's images are too large to include in a PDF.",
    })
    expect(render.embedPng).toHaveBeenCalledTimes(4)
  })

  it("charges a PNG shown on every page only once", async () => {
    const render = createStubRender()
    const logo = createPngDataUrl(4_000, 4_000, 1)
    const others = [2, 3, 4].map((salt: number): string =>
      createPngDataUrl(4_000, 4_000, salt)
    )

    for (const dataUrl of [logo, logo, ...others, logo]) {
      await embedPdfLibImage(render.context, dataUrl)
    }

    expect(render.embedPng).toHaveBeenCalledTimes(4)
  })

  it("embeds JPEGs without decoding them, so they spend none of the PNG allowance", async () => {
    const render = createStubRender()
    const portraitPhoto = toImageDataUrl("jpeg", createJpegBytes(6_000, 8_000))

    await embedPdfLibImage(render.context, PHONE_PHOTO)
    for (const salt of [1, 2, 3, 4]) {
      await embedPdfLibImage(render.context, createPngDataUrl(4_000, 4_000, salt))
    }
    await embedPdfLibImage(render.context, portraitPhoto)

    expect(render.embedPng).toHaveBeenCalledTimes(4)
    expect(render.embedJpg).toHaveBeenCalledTimes(2)
  })

  it("embeds real PNG and JPEG bytes through pdf-lib", async () => {
    const context = {
      document: await PDFDocument.create(),
      imageCache: new Map<string, PDFImage>(),
    } as unknown as PdfLibRenderContext

    const png = await embedPdfLibImage(
      context,
      toImageDataUrl("png", createPngBytes(40, 20))
    )
    const jpeg = await embedPdfLibImage(context, PHONE_PHOTO)

    expect([png.width, png.height, jpeg.width, jpeg.height]).toEqual([
      40, 20, 8_000, 6_000,
    ])
  })
})

function createPngDataUrl(width: number, height: number, salt = 0): string {
  return toImageDataUrl("png", createPngHeaderBytes(width, height, salt))
}

// Stand-in decoders: an oversized PNG must be refused before pdf-lib would
// allocate its pixels, so these record each call and read only the header.
function createStubRender(): StubRender {
  const embedPng = vi.fn(async (bytes: Uint8Array): Promise<PDFImage> => {
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    return {
      height: header.getUint32(20),
      width: header.getUint32(16),
    } as unknown as PDFImage
  })
  const embedJpg = vi.fn(
    async (): Promise<PDFImage> =>
      ({ height: 6_000, width: 8_000 }) as unknown as PDFImage
  )
  const context = {
    document: { embedJpg, embedPng },
    imageCache: new Map<string, PDFImage>(),
  } as unknown as PdfLibRenderContext

  return { context, embedJpg, embedPng }
}
