import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from "pdf-lib"
import { readFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createSampleDocumentInput } from "@/services/document-pdf/sample-document.test-support"
import { imageBlockSchema, type TemplateLayout, type TemplateBlock } from "@/types/template"

// Rendering embeds whole fonts, which can take seconds on a busy machine.
const RENDER_TIMEOUT_MS = 30_000
const ids = (index: number): string => `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`

async function render(blocks: TemplateBlock[], layout?: Partial<TemplateLayout>): Promise<PDFDocument> {
  const sample = createSampleDocumentInput("2026-07-17T19:30:00.000Z")
  const bytes = await renderGeneratedDocumentPdf({
    ...sample,
    content: { ...(sample.content as Record<string, unknown>), blockRules: [], blocks, fieldGroups: [], sections: [], ...(layout ? { layout } : {}) },
    signers: [],
  })

  return PDFDocument.load(bytes)
}

// The faces a page draws with, by name, without the tags pdf-lib adds to it.
function faces(document: PDFDocument, pageIndex: number): string[] {
  const fonts = document.getPage(pageIndex).node.Resources()?.lookup(PDFName.of("Font"), PDFDict)

  return (fonts?.values() ?? []).map((ref) => {
    const font = document.context.lookup(ref, PDFDict)
    return String(font.get(PDFName.of("BaseFont"))).replace(/^\/([A-Z]{6}\+)?/, "").replace(/-\d+$/, "")
  })
}

// Each page's drawing instructions, as text.
function contents(document: PDFDocument): string[] {
  return document.getPages().map((page) => {
    const entries = page.node.Contents()
    const streams = entries instanceof PDFArray ? entries.asArray() : entries ? [entries] : []

    return streams
      .map((entry) => {
        const stream = document.context.lookup(entry)
        return stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") : ""
      })
      .join("\n")
  })
}

// How many times the whole document shows text: once for each word it prints.
function textShown(document: PDFDocument): number {
  return contents(document).join("\n").match(/\bT[jJ]\b/g)?.length ?? 0
}

// The level rules drawn above the footer of the first page, as [from, to].
function rules(document: PDFDocument): Array<[number, number]> {
  return [...contents(document)[0]!.matchAll(/(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\b/g)]
    .filter(([, , y1, , y2]) => y1 === y2 && Number(y1) > 40)
    .map(([, x1, , x2]) => [Number(x1), Number(x2)])
}

// How high above the foot of its page each word printed at this size sits.
function baselines(document: PDFDocument, size: number): number[] {
  return contents(document).flatMap((page) =>
    page.split(/\bBT\b/).flatMap((text) => {
      const shownAt = / ([\d.]+) Tf\b/.exec(text)?.[1]
      const y = /(-?[\d.]+) Tm\b/.exec(text)?.[1]
      return Number(shownAt) === size && y ? [Number(y)] : []
    })
  )
}

describe("formatted text in a PDF", () => {
  it(
    "prints bold, italic and bold italic words in their own faces, adding the slanted ones only when used",
    async () => {
      const formatted = await render([
        {
          alignment: "left",
          id: ids(1),
          runs: [
            { text: "Payment is due " },
            { bold: true, text: "within 30 days" },
            { text: ", " },
            { italic: true, text: "without exception" },
            { text: ", " },
            { bold: true, italic: true, text: "in full" },
            { text: "." },
          ],
          text: "Payment is due within 30 days, without exception, in full.",
          type: "paragraph",
        },
      ])
      const plain = await render([{ alignment: "left", id: ids(1), text: "Payment is due within 30 days.", type: "paragraph" }])

      expect(faces(formatted, 0)).toEqual(expect.arrayContaining(["DejaVuSans", "DejaVuSans-Bold", "DejaVuSans-Oblique", "DejaVuSans-BoldOblique"]))
      expect(faces(plain, 0).some((face) => face.includes("Oblique"))).toBe(false)
    },
    RENDER_TIMEOUT_MS
  )

  it(
    "keeps a link clickable, pointing where it was set to, and underlined as one",
    async () => {
      const document = await render([
        {
          alignment: "left",
          id: ids(1),
          runs: [{ text: "Pay through " }, { link: "https://pay.example.com/invoices", text: "the portal" }, { text: "." }],
          text: "Pay through the portal.",
          type: "paragraph",
        },
      ])
      const annotations = document.getPage(0).node.Annots()
      const targets = (annotations?.asArray() ?? []).map((ref) => {
        const action = document.context.lookup(ref, PDFDict).lookup(PDFName.of("A"), PDFDict)
        return action.lookup(PDFName.of("URI"), PDFString).decodeText()
      })

      const underline = rules(document)
      const reach = Math.max(...underline.map(([, to]) => to)) - Math.min(...underline.map(([from]) => from))

      expect(annotations).toBeInstanceOf(PDFArray)
      expect(targets).toEqual(["https://pay.example.com/invoices"])
      // Underlined as one, across the space between its words.
      expect(underline.length).toBeGreaterThan(0)
      expect(underline.reduce((total, [from, to]) => total + to - from, 0)).toBeCloseTo(reach)
    },
    RENDER_TIMEOUT_MS
  )

  it(
    "carries a long formatted paragraph onto the next page with its formatting",
    async () => {
      const sentence = "The provider cleans every office on the agreed day. "
      const runs = Array.from({ length: 90 }, (_, index) => ({
        text: sentence,
        ...(index % 2 === 1 ? { bold: true as const } : {}),
      }))
      const document = await render([
        { alignment: "left", id: ids(1), runs, text: sentence.repeat(90).trim(), type: "paragraph" },
      ])

      // 810 words, each printed once rather than once per page-sized piece,
      // plus the title and the page numbers.
      expect(textShown(document)).toBeGreaterThanOrEqual(810)
      expect(textShown(document)).toBeLessThan(820)
      expect(document.getPageCount()).toBe(2)
      expect(faces(document, 1)).toContain("DejaVuSans-Bold")
    },
    RENDER_TIMEOUT_MS
  )

  it(
    "starts a new page rather than letting bigger text run off the foot of one",
    async () => {
      const long = { size: 24, text: "The provider cleans every office on the agreed day. ".repeat(38).trim() }
      const document = await render([
        { alignment: "left", id: ids(1), runs: [long], text: long.text, type: "paragraph" },
        { id: ids(2), itemRuns: [[long]], items: [long.text], type: "bullet_list" },
        ...Array.from({ length: 16 }, (_, index) => ({
          alignment: "left" as const,
          id: ids(3 + index),
          level: 2 as const,
          runs: [{ size: 36, text: `Visit ${index + 1}` }],
          text: `Visit ${index + 1}`,
          type: "heading" as const,
        })),
      ])

      // Every word printed, and none below the writing area, which ends 46pt
      // above the foot of an A4 page.
      expect(textShown(document)).toBeGreaterThanOrEqual(684 + 32)
      expect(Math.min(...baselines(document, 24), ...baselines(document, 36))).toBeGreaterThan(46)
    },
    RENDER_TIMEOUT_MS
  )
})


describe("fonts, placed pictures and spacing in a PDF", () => {
  it(
    "prints a chosen family from its own file, and in the default face whatever that family cannot",
    async () => {
      const roboto = await readFile("src/services/document-pdf/fixtures/roboto-latin-400-normal.woff2")
      const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(roboto))

      try {
        const document = await render([
          {
            alignment: "left",
            id: ids(1),
            runs: [{ font: "roboto", text: "Invoice Ж " }, { font: "no-such-font", text: "due" }],
            text: "Invoice Ж due",
            type: "paragraph",
          },
        ])

        expect(faces(document, 0).filter((face) => face.startsWith("Roboto"))).toEqual(["Roboto-Regular"])
        expect(network.mock.calls.map(([url]) => String(url))).toEqual([
          "https://cdn.jsdelivr.net/fontsource/fonts/roboto@5.3.0/latin-400-normal.woff2",
          "https://cdn.jsdelivr.net/fontsource/fonts/roboto@5.3.0/cyrillic-400-normal.woff2",
        ])
      } finally {
        network.mockRestore()
      }
    },
    RENDER_TIMEOUT_MS
  )

  it(
    "prints a placed picture on its own page, where it was put",
    async () => {
      const document = await render([
        imageBlockSchema.parse({
          altText: "Seal",
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lJ8AAAAASUVORK5CYII=",
          id: ids(1),
          placement: { height: 20, page: 2, width: 20, x: 25, y: 30 },
          type: "image",
        }),
      ])
      const [first, second] = contents(document)
      const { height, width } = document.getPage(1).getSize()
      // Moved to its corner, then scaled to its size. A square in a taller box
      // sits in its middle, and PDF measures up from the foot of the page.
      const placed = /1 0 0 1 ([\d.]+) ([\d.]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm/.exec(second ?? "")

      expect(document.getPageCount()).toBe(2)
      expect(first).not.toMatch(/\/Image\S* Do/)
      expect(second).toMatch(/\/Image\S* Do/)
      expect(placed?.slice(1).map(Number)).toEqual([
        expect.closeTo(width * 0.25),
        expect.closeTo(height * 0.7 - (height * 0.2 + width * 0.2) / 2),
        expect.closeTo(width * 0.2),
        expect.closeTo(width * 0.2),
      ])
    },
    RENDER_TIMEOUT_MS
  )

  it(
    "spaces lines and paragraphs by the numbers set, inside the margins set",
    async () => {
      const text = "The provider cleans every office on the agreed day and brings every supply the work needs, at no extra cost."
      const document = await render(
        [1, 2].map((index) => ({ alignment: "left" as const, id: ids(index), text, type: "paragraph" as const })),
        {
          footerPolicy: "none",
          headerPolicy: "none",
          lineSpacing: 2,
          margins: { bottom: 50, left: 70, right: 30, top: 60 },
          paragraphSpacing: 18,
          printedTitle: { mode: "none" },
        }
      )
      const lines = baselines(document, 10)

      // Two lines each: 20pt apart within a paragraph, 18pt more between them.
      expect(lines.map((line, index) => Math.round((lines[index - 1] ?? line) - line))).toEqual([0, 20, 38, 20])
      // The first line starts at the left margin, its baseline 10pt below the top one.
      expect(contents(document)[0]).toContain(`1 0 0 1 70 ${841.89 - 60 - 10} Tm`)
    },
    RENDER_TIMEOUT_MS
  )
})
