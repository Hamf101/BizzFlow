import { createHash } from "node:crypto"

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs"
import { degrees, PDFDocument, PDFName, StandardFonts } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { pointOnPage, type PdfPageBox } from "@/lib/pdf/field-geometry"
import type { PdfField } from "@/types/pdf-fields"

import { stampUploadedPdf } from "./pdf-lib-stamping"

const SIGNER = "50000000-0000-4000-8000-000000000001"
const TIMESTAMP = "2026-09-29T09:00:00.000Z"
// One ink-coloured pixel, as a drawn signature arrives.
const DRAWING = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const field = (id: number, overrides: Partial<PdfField>): PdfField => ({
  fontSize: null,
  height: 0.04,
  id: `60000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  kind: "text",
  label: null,
  page: 1,
  required: true,
  signerId: SIGNER,
  width: 0.4,
  x: 0.1,
  y: 0.8,
  ...overrides,
})
const NAME = field(1, {})
const AGREED = field(2, { height: 0.03, kind: "checkbox", width: 0.03, x: 0.6, y: 0.8 })
const SIGNED = field(3, { height: 0.08, kind: "signature", width: 0.3, x: 0.1, y: 0.6 })
const TURNED = field(4, { page: 2, width: 0.3, x: 0.1, y: 0.1 })

// An upload as people send them: an upright Letter page, then a cropped page
// shown on its side, with the author's metadata and a script to run on opening.
async function upload(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  pdf.setTitle("Draft with notes")
  pdf.setAuthor("Someone at Northwind")
  pdf.setKeywords(["internal"])
  pdf.addPage([612, 792]).drawText("Tenant", { font, size: 12, x: 72, y: 150 })
  const turned = pdf.addPage([600, 800])
  turned.setCropBox(10, 20, 580, 760)
  turned.setRotation(degrees(90))
  pdf.addJavaScript("greet", "app.alert('hello')")
  return pdf.save()
}

async function stamp(source: Uint8Array): Promise<Uint8Array> {
  return stampUploadedPdf({
    fields: [NAME, AGREED, SIGNED, TURNED],
    metadataTimestamp: TIMESTAMP,
    source,
    title: "Lease agreement",
    values: {
      [AGREED.id]: { kind: "checked" },
      [NAME.id]: { kind: "text", text: "Jordan Ellis" },
      [SIGNED.id]: { dataUrl: DRAWING, kind: "drawing" },
      [TURNED.id]: { kind: "text", text: "On its side" },
    },
  })
}

// Where a field covers, in the PDF's own space.
function areaOf(page: PdfPageBox, placed: PdfField): { bottom: number; left: number; right: number; top: number } {
  const corners = [
    pointOnPage(page, { x: placed.x, y: placed.y }),
    pointOnPage(page, { x: placed.x + placed.width, y: placed.y + placed.height }),
  ]

  return {
    bottom: Math.min(...corners.map((corner) => corner.y)),
    left: Math.min(...corners.map((corner) => corner.x)),
    right: Math.max(...corners.map((corner) => corner.x)),
    top: Math.max(...corners.map((corner) => corner.y)),
  }
}

async function wordsOn(pdf: Uint8Array, pageNumber: number): Promise<Array<{ str: string; transform: number[] }>> {
  const document = await getDocument({ data: pdf.slice() }).promise
  const page = await document.getPage(pageNumber)
  const content = await page.getTextContent()
  return content.items.filter((item): item is { str: string; transform: number[] } & typeof item => "str" in item)
}

describe("stamping values onto an uploaded PDF", () => {
  it("writes each value where its field was placed, upright on a page shown on its side too", async () => {
    const stamped = await stamp(await upload())
    const upright = (await wordsOn(stamped, 1)).find((item) => item.str === "Jordan Ellis")
    const sideways = (await wordsOn(stamped, 2)).find((item) => item.str === "On its side")
    const first = areaOf({ height: 792, rotation: 0, width: 612, x: 0, y: 0 }, NAME)
    const second = areaOf({ height: 760, rotation: 90, width: 580, x: 10, y: 20 }, TURNED)

    for (const [item, area] of [[upright, first], [sideways, second]] as const) {
      const [, , , , x, y] = item!.transform
      expect(x).toBeGreaterThanOrEqual(area.left)
      expect(x).toBeLessThanOrEqual(area.right)
      expect(y).toBeGreaterThanOrEqual(area.bottom)
      expect(y).toBeLessThanOrEqual(area.top)
    }

    // On the page turned a quarter clockwise, the words run up the page, so they read left to right as shown.
    expect(sideways!.transform[0]).toBeCloseTo(0)
    expect(sideways!.transform[1]).toBeGreaterThan(0)
    const drawn = await (await (await getDocument({ data: stamped.slice() }).promise).getPage(1)).getOperatorList()
    expect(drawn.fnArray).toContain(OPS.paintImageXObject)
  })

  it("keeps none of the upload's own metadata or scripts, and makes the same file every time", async () => {
    const source = await upload()
    const before = createHash("sha256").update(source).digest("hex")
    const stamped = await stamp(source)
    const read = await PDFDocument.load(stamped)

    expect(read.getTitle()).toBe("Lease agreement")
    expect(read.getAuthor()).toBeUndefined()
    expect(read.getKeywords()).toBeUndefined()
    expect(read.catalog.get(PDFName.of("Names"))).toBeUndefined()
    expect(read.catalog.get(PDFName.of("OpenAction"))).toBeUndefined()
    expect(read.getPages().map((page) => [page.getRotation().angle, page.getCropBox()])).toEqual([
      [0, { height: 792, width: 612, x: 0, y: 0 }],
      [90, { height: 760, width: 580, x: 10, y: 20 }],
    ])
    expect(createHash("sha256").update(source).digest("hex")).toBe(before)
    expect(Buffer.from(await stamp(source)).equals(Buffer.from(stamped))).toBe(true)
  })

  it("closes with the signing certificate: who signed, when, from where, and that they agreed", async () => {
    const stamped = await stampUploadedPdf({
      certificate: {
        documentId: "70000000-0000-4000-8000-000000000001",
        signers: [
          { consentedAt: TIMESTAMP, email: "jordan@example.com", id: SIGNER, name: "Jordan Ellis", requiresSignature: true, signedAt: TIMESTAMP, signedIp: "203.0.113.7", status: "signed" },
        ],
      },
      fields: [NAME],
      metadataTimestamp: TIMESTAMP,
      source: await upload(),
      title: "Lease agreement",
      values: { [NAME.id]: { kind: "text", text: "Jordan Ellis" } },
    })
    const words = (await wordsOn(stamped, 3)).map((item) => item.str).join(" ")

    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(3)
    expect(words).toContain("Signing certificate")
    expect(words).toContain("jordan@example.com")
    expect(words).toContain("203.0.113.7")
  })

  it("turns away a PDF locked with a password", async () => {
    const locked = await PDFDocument.create()
    locked.addPage()
    locked.context.trailerInfo.Encrypt = locked.context.obj({ Filter: "Standard" })

    await expect(stamp(await locked.save())).rejects.toMatchObject({ statusCode: 400 })
  })
})
