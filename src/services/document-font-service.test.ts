import { readFile } from "node:fs/promises"

import { expect, it, vi } from "vitest"

import { getDocumentFontAsset, resolveDocumentFont } from "@/services/document-font-service"

it("finds the face CSS would draw a character in, and the slice of the family that holds it", async () => {
  expect(await resolveDocumentFont("roboto", true, true, "A")).toEqual({ file: "latin-700-italic.woff2" })
  expect(await resolveDocumentFont("roboto", false, false, "Ж")).toEqual({ file: "cyrillic-400-normal.woff2" })
  // Japanese comes in numbered slices; the character's own slice is the file.
  expect((await resolveDocumentFont("noto-sans-jp", false, false, "日"))?.file).toMatch(/^\d+-400-normal\.woff2$/)
  // Without a 400, regular text takes the 500 before the 300, as CSS does.
  expect((await resolveDocumentFont("sunflower", false, false, "A"))?.file).toMatch(/-500-normal\.woff2$/)
  // A family with one face draws everything in it.
  expect(await resolveDocumentFont("abel", true, true, "A")).toEqual({ file: "latin-400-normal.woff2" })
  expect(await resolveDocumentFont("molle", false, false, "A")).toEqual({ file: "latin-400-italic.woff2" })

  expect(await resolveDocumentFont("roboto", false, false, "日")).toBeNull()
  expect(await resolveDocumentFont("no-such-font", false, false, "A")).toBeNull()
})

it("offers only the faces a document shows, every slice with its range", async () => {
  const fetcher = vi.fn<typeof fetch>()
  const roboto = (await getDocumentFontAsset("roboto", "font.css", fetcher)).body.toString()
  const japanese = (await getDocumentFontAsset("noto-sans-jp", "font.css", fetcher)).body.toString()

  expect([...new Set(roboto.match(/font-style:\w+;font-weight:\d+/g))].sort()).toEqual([
    "font-style:italic;font-weight:400",
    "font-style:italic;font-weight:700",
    "font-style:normal;font-weight:400",
    "font-style:normal;font-weight:700",
  ])
  expect(roboto).toContain('src:url("/fonts/roboto/cyrillic-700-italic.woff2")')
  expect(roboto).toContain("/fonts/roboto/license.txt")
  expect(japanese).toMatch(/src:url\("\/fonts\/noto-sans-jp\/\d+-400-normal\.woff2"\) format\("woff2"\);unicode-range:U\+/)
  expect(`${roboto}${japanese}`).not.toContain("undefined")
  expect(fetcher).not.toHaveBeenCalled()
})

it("serves nothing outside the catalog, rejecting before anything is fetched", async () => {
  const fetcher = vi.fn<typeof fetch>()

  for (const [font, file] of [
    ["../secrets", "latin-400-normal.woff2"],
    ["no-such-font", "latin-400-normal.woff2"],
    ["roboto", "../../secrets"],
    ["roboto", "latin-100-normal.woff2"],
    ["default", "toString"],
  ] as const) {
    await expect(getDocumentFontAsset(font, file, fetcher)).rejects.toMatchObject({ statusCode: 404 })
  }

  expect(fetcher).not.toHaveBeenCalled()
})

it("fetches the pinned version of a face and says when Fontsource cannot give it", async () => {
  const bytes = await readFile("src/services/document-pdf/fixtures/roboto-latin-400-normal.woff2")
  const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes))

  expect(await getDocumentFontAsset("roboto", "latin-400-normal.woff2", fetcher)).toEqual({ body: bytes, contentType: "font/woff2" })
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://cdn.jsdelivr.net/fontsource/fonts/roboto@5.3.0/latin-400-normal.woff2")
  await expect(
    getDocumentFontAsset("roboto", "latin-400-normal.woff2", async () => new Response("", { status: 503 }))
  ).rejects.toMatchObject({ statusCode: 502 })
})

it("serves the default family from the PDF's own faces", async () => {
  const css = (await getDocumentFontAsset("default", "font.css")).body.toString()

  expect(css.match(/@font-face/g)).toHaveLength(4)
  expect((await getDocumentFontAsset("default", "bold.ttf")).body).toEqual(
    await readFile("node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf")
  )
})
