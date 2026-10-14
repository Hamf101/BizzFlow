// @vitest-environment jsdom
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { inflateRawSync } from "node:zlib"

import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"

import { renderGeneratedDocumentDocx } from "@/services/document-docx-service"
import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createSampleDocumentInput } from "@/services/document-pdf/sample-document.test-support"
import type { RenderGeneratedDocumentPdfInput } from "@/services/document-pdf/types"
import { hasAllowedFileSignature } from "@/lib/r2/stored-file"
import type { TemplateBlock, TemplateContent } from "@/types/template"

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// The sample the PDF fingerprint guards, plus a field left empty and one its rule hides.
function sampleInput(): RenderGeneratedDocumentPdfInput {
  const input = createSampleDocumentInput("2026-07-17T19:30:00.000Z")
  const content = input.content as TemplateContent
  const extra: TemplateBlock[] = [
    { id: "00000000-0000-4000-8000-000000000020", type: "text_field", fieldKey: "witness", label: "Witness name", required: false, helpText: null, placeholder: null, multiline: false },
    {
      id: "00000000-0000-4000-8000-000000000021",
      type: "text_field",
      fieldKey: "refusal",
      label: "Reason terms were refused",
      required: false,
      helpText: null,
      placeholder: null,
      multiline: false,
      // Shown only when the terms were not accepted; the sample accepts them.
      visibleWhen: { sourceBlockId: "00000000-0000-4000-8000-000000000009", operator: "equals", value: false }
    }
  ]

  return { ...input, content: { ...content, blocks: [...content.blocks.slice(0, 9), ...extra, ...content.blocks.slice(9)] } }
}

describe("generated document Word export", () => {
  it("prints the PDF's pages, words, page setup and fields", async () => {
    const input = sampleInput()
    const [docx, pdf] = await Promise.all([renderGeneratedDocumentDocx(input), renderGeneratedDocumentPdf(input)])
    const files = unzip(docx)
    const body = files.get("word/document.xml") ?? ""
    const words = textOf(body)

    expect(hasAllowedFileSignature(docx, DOCX)).toBe(true)
    // A page break before every page but the first, as the PDF pages it.
    expect(body.split("<w:pageBreakBefore/>").length).toBe((await PDFDocument.load(pdf)).getPageCount())
    // A4 with the sample's 40-point margins, in twentieths of a point.
    expect(body).toMatch(/<w:pgSz w:w="11906" w:h="16838"/)
    expect(body).toMatch(/<w:pgMar w:top="800" w:right="800" w:bottom="800" w:left="800"/)
    expect([...files.keys()].some((name) => /^word\/footer\d+\.xml$/.test(name))).toBe(true)
    expect([...files.entries()].filter(([name]) => name.startsWith("word/footer")).map(([, xml]) => xml).join("")).toMatch(/Page [\s\S]*NUMPAGES/)
    // The fonts the PDF prints in travel with the file.
    expect(files.get("word/fontTable.xml")).toContain('w:name="DejaVu Sans"')
    expect(files.get("word/fontTable.xml")).toMatch(/<w:embedRegular [^>]*\/><w:embedBold /)
    expect([...files.keys()].filter((name) => name.endsWith(".odttf"))).toHaveLength(2)

    expect(inOrder(words, [
      "Professional services agreement",
      "CONFIDENTIAL - CLIENT AGREEMENT",
      "Engagement overview",
      "Discovery and requirements workshop",
      "Implementation",
      "Client legal name *",
      "Northstar Labs LLC",
      "Commercial terms accepted",
      "Witness name",
      "Monthly retainer",
      "1,250",
      "Readiness check",
      "Robin Hale",
      "Detailed service terms",
      "Service detail 18.",
      "BizFlow Studio - BF-2026-0717",
      "Signing record",
      "Avery Morgan",
      "Jordan Lee"
    ])).toBe(true)
    expect(words).toContain("☒Commercial terms accepted")
    // A grid's two answers chosen, its other seven choices empty.
    expect(words.split("●").length - 1).toBe(2)
    expect(words.split("○").length - 1).toBe(7)
    // The empty field still has its box, with nothing in it.
    expect(firstCellAfter(body, "Witness name")).toContain('<w:top w:val="single"')
    expect(textOf(firstCellAfter(body, "Witness name"))).toBe("")
    expect(textOf(firstCellAfter(body, "Client legal name"))).toBe("Northstar Labs LLC")
    expect(words).not.toContain("Reason terms were refused")
    // Signatures and initials, as pictures.
    expect([...files.keys()].filter((name) => name.startsWith("word/media/")).length).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it("still writes a valid file from hostile titles, answers and a 500-row table", async () => {
    const hostile = `<&"'>\u0001\u0008\u000b\u001f￿\ud800 ]]> &amp;`
    const base = createSampleDocumentInput()
    const content = base.content as Extract<TemplateContent, { schemaVersion: 3 }>
    const input: RenderGeneratedDocumentPdfInput = {
      ...base,
      title: `Title ${hostile}`,
      answers: { ...base.answers, client_name: `${"W".repeat(5_000)} ${hostile}`, po_reference: hostile },
      content: {
        ...content,
        branding: { ...content.branding, organizationName: hostile },
        layout: { ...content.layout, headerText: { center: `{title} ${hostile} {page}` }, footerText: { left: hostile } },
        blocks: [
          ...content.blocks,
          {
            id: "00000000-0000-4000-8000-000000000031",
            type: "paragraph",
            text: `Linked ${hostile}`,
            alignment: "left",
            runs: [{ text: `Linked ${hostile}`, link: `https://example.test/?a="<&'>`, highlight: "#FFEE00", font: "open-sans" }]
          },
          {
            id: "00000000-0000-4000-8000-000000000030",
            type: "table",
            headers: ["A", hostile],
            rows: Array.from({ length: 500 }, (_value: unknown, index: number): string[] => [`${index}`, `${hostile} ${"x".repeat(300)}`])
          }
        ]
      }
    }
    // Each way a section and a field can print: in a bar, a box, on a line, in cells side by side.
    const styles = [
      { fieldStyle: "box", sectionStyle: "plain" },
      { fieldStyle: "line", sectionStyle: "band" },
      { fieldStyle: "cell", sectionStyle: "box" }
    ] as const

    for (const style of styles) {
      const styled = input.content as typeof content
      const docx = await renderGeneratedDocumentDocx({
        ...input,
        content: {
          ...styled,
          layout: { ...styled.layout, ...style },
          sections: [{ id: "00000000-0000-4000-8000-000000000040", keepTogether: false, label: hostile, pageBreakBefore: false, startBlockId: "00000000-0000-4000-8000-000000000006" }],
          fieldGroups: [{ columns: 2, endBlockId: "00000000-0000-4000-8000-000000000007", id: "00000000-0000-4000-8000-000000000041", keepTogether: false, label: null, startBlockId: "00000000-0000-4000-8000-000000000006" }]
        }
      })
      const files = unzip(docx)

      expect(hasAllowedFileSignature(docx, DOCX)).toBe(true)

      for (const [name, xml] of files) {
        if (name.endsWith(".xml") || name.endsWith(".rels")) {
          const parsed = new DOMParser().parseFromString(xml, "application/xml")

          expect(parsed.getElementsByTagName("parsererror"), name).toHaveLength(0)
        }
      }

      expect(textOf(files.get("word/document.xml") ?? "")).toContain(`<&"'> ]]> &amp;`)
    }
  }, 60_000)

  // Not a check: writes the sample and its PDF side by side for a person to compare.
  it.runIf(process.env.RENDER_SAMPLE_DOCX)("writes the sample for eyeballing", async () => {
    const directory = process.env.RENDER_SAMPLE_DOCX as string
    const input = sampleInput()

    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "docx-sample.docx"), await renderGeneratedDocumentDocx(input))
    await writeFile(join(directory, "docx-sample.pdf"), await renderGeneratedDocumentPdf(input))
    expect(directory).toBeTruthy()
  }, 30_000)
})

// Every entry of a zip, by name, read with nothing but Node.
function unzip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>()
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  let at = bytes.readUInt32LE(end + 16)

  for (let index = bytes.readUInt16LE(end + 10); index > 0; index -= 1) {
    const nameLength = bytes.readUInt16LE(at + 28)
    const local = bytes.readUInt32LE(at + 42)
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28)
    const data = bytes.subarray(start, start + bytes.readUInt32LE(at + 20))

    files.set(bytes.toString("utf8", at + 46, at + 46 + nameLength), (bytes.readUInt16LE(at + 10) === 8 ? inflateRawSync(data) : data).toString("utf8"))
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32)
  }

  return files
}

// The words of a part, in order, as Word reads them.
function textOf(xml: string): string {
  const entities: Record<string, string> = { "&amp;": "&", "&apos;": "'", "&gt;": ">", "&lt;": "<", "&quot;": '"' }

  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => (match[1] ?? "").replace(/&(?:amp|apos|gt|lt|quot);/g, (entity) => entities[entity] ?? entity)).join("")
}

function inOrder(text: string, phrases: readonly string[]): boolean {
  let from = 0

  return phrases.every((phrase: string): boolean => {
    const at = text.indexOf(phrase, from)

    from = at + phrase.length

    return at >= 0
  })
}

// The first table cell after a field's label: its answer box.
function firstCellAfter(xml: string, label: string): string {
  const after = xml.slice(xml.indexOf(`>${label}`))

  return after.slice(after.indexOf("<w:tc>"), after.indexOf("</w:tc>"))
}
