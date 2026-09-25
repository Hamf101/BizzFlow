// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { type ImageUploadGrant, type ImageUploadRequest, storeTemplateImage } from "@/components/templates/template-image"

const ASSET = { height: 3_024, id: "40000000-0000-4000-8000-000000000001", type: "jpeg" as const, url: "https://r2.example.com/display", width: 4_032 }
let writesWebp = true
const puts: { contentType: string | null; size: number; url: string }[] = []

beforeEach(() => {
  writesWebp = true
  puts.length = 0
  vi.stubGlobal("createImageBitmap", async (file: File) => {
    const [width, height] = file.name.split(".")[0]!.split("x").map(Number)
    return { close: vi.fn(), height, width }
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never)
  // Each copy's size is its width, so the copies' sizes show how they were scaled.
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, done, type) {
    const written = type === "image/webp" && !writesWebp ? "image/png" : (type ?? "image/png")
    done(new Blob([new Uint8Array(this.width)], { type: written }))
  })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    puts.push({ contentType: new Headers(init.headers).get("content-type"), size: (init.body as Blob).size, url })
    return new Response(null, { status: 200 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function server(answer: (request: ImageUploadRequest) => ImageUploadGrant = (request) => ({
  asset: ASSET,
  uploads: Object.entries(request.copies).map(([copy, spec]) => ({ contentType: spec.contentType, copy: copy as never, url: `https://r2.example.com/${copy}` })),
})) {
  const requests: ImageUploadRequest[] = []

  return { request: async (request: ImageUploadRequest) => (requests.push(request), answer(request)), requests }
}

const photo = (name: string, type = "image/jpeg") => new File([new Uint8Array(5_000)], name, { type })

it("stores a phone photo with a light copy for pages and a print-sized copy, each uploaded where it was told", async () => {
  const { request, requests } = server()

  await expect(storeTemplateImage(photo("4032x3024.jpg"), request)).resolves.toEqual(ASSET)

  expect(requests[0]).toEqual({
    copies: {
      display: { bytes: 1_600, contentType: "image/webp" },
      original: { bytes: 5_000, contentType: "image/jpeg" },
      print: { bytes: 3_000, contentType: "image/jpeg" },
    },
    height: 3_024,
    type: "jpeg",
    width: 4_032,
  })
  expect(puts).toEqual(
    expect.arrayContaining([
      { contentType: "image/webp", size: 1_600, url: "https://r2.example.com/display" },
      { contentType: "image/jpeg", size: 5_000, url: "https://r2.example.com/original" },
      { contentType: "image/jpeg", size: 3_000, url: "https://r2.example.com/print" },
    ])
  )
})

it("keeps a photo's light copy a JPEG where the browser can't write WebP", async () => {
  writesWebp = false
  const { request, requests } = server()

  await storeTemplateImage(photo("1200x800.jpg"), request)

  expect(requests[0]?.copies.display.contentType).toBe("image/jpeg")
})

it("refuses a PNG too large to print before anything is uploaded", async () => {
  const { request, requests } = server()

  await expect(storeTemplateImage(photo("3000x6000.png", "image/png"), request)).rejects.toThrow("PNG images can be up to 16 megapixels")
  expect(requests).toHaveLength(0)
})

it("refuses a file that isn't a PNG or JPEG, and passes on the server's reason", async () => {
  await expect(storeTemplateImage(photo("400x300.gif", "image/gif"), server().request)).rejects.toThrow("Choose a PNG or JPEG image.")
  await expect(storeTemplateImage(photo("400x300.jpg"), server(() => ({ error: "You cannot add pictures." })).request)).rejects.toThrow(
    "You cannot add pictures."
  )
  expect(puts).toHaveLength(0)
})
