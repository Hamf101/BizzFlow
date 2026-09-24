// @vitest-environment jsdom
import { describe, expect, it } from "vitest"

import { readTemplateImage } from "@/components/templates/template-image"
import {
  createJpegBytes,
  createPngHeaderBytes,
  toImageDataUrl,
} from "@/lib/image-header.test-support"

describe("readTemplateImage", () => {
  it("reads a phone photo as a data URL", async () => {
    const bytes = createJpegBytes(4_032, 3_024)
    const file = new File([new Uint8Array(bytes)], "photo.jpg", {
      type: "image/jpeg",
    })

    await expect(readTemplateImage(file)).resolves.toBe(
      toImageDataUrl("jpeg", bytes)
    )
  })

  it("refuses a PNG over 16 megapixels before it reaches the template", async () => {
    const bytes = new Uint8Array(createPngHeaderBytes(4_001, 4_000))
    const file = new File([bytes], "plan.png", { type: "image/png" })

    await expect(readTemplateImage(file)).rejects.toThrow(
      "PNG images can be up to 16 megapixels. Use a smaller image or a JPEG."
    )
  })

  it("refuses a file whose image header cannot be read", async () => {
    const file = new File(["hello"], "logo.png", { type: "image/png" })

    await expect(readTemplateImage(file)).rejects.toThrow(
      "The selected image could not be validated."
    )
  })
})
