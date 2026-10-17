import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFRef
} from "pdf-lib"
import { describe, expect, it } from "vitest"

import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createSampleDocumentInput } from "@/services/document-pdf/sample-document.test-support"

/**
 * Deterministic fingerprint of the generated-document renderer.
 *
 * This replaces the reference PNG/PDF renders that used to live under
 * `artifacts/verification/`. Those are no longer committed, so CI has nothing to
 * diff against — a silent change in PDF output would otherwise reach a customer
 * before anyone noticed.
 *
 * Comparing whole-file bytes would be too brittle to be useful: pdf-lib is free
 * to renumber objects or reflow the xref table without changing a single mark on
 * the page. So the assertions below target what actually reaches the paper —
 * page count, page geometry, and a hash of each decompressed content stream —
 * plus a same-input/same-bytes check that proves the render is reproducible at
 * all.
 *
 * When a hash changes, that is not automatically a bug. Render the sample with
 * `RENDER_SAMPLE=1 pnpm vitest run src/services/document-pdf-fingerprint.test.ts`
 * (or `RENDER_SAMPLE=<path>` to choose where it goes), look at it, and update
 * the constant only once you are satisfied the change is the one you intended.
 */

// Any fixed RFC 3339 instant works; this one matches the sample's signing dates
// so the rendered metadata and the visible signature timestamps agree.
const FIXED_METADATA_TIMESTAMP = "2026-07-17T19:30:00.000Z"

const EXPECTED_PAGE_COUNT = 5

// A4 at 72dpi (595.28 x 841.89 points, as template-render-plan.ts sizes it), rounded.
// Deliberately written out rather than imported: importing the constants would
// make both sides of the assertion move together, so switching the renderer to
// Letter would silently pass.
const EXPECTED_PAGE_SIZE = { height: 842, width: 595 }

// The sample gained a prefix and suffix, a comb, a checkbox group, a choice
// grid and a fill-in table (2026-10-01), which pushed it onto a fourth page.
// A list's words hang clear of their markers (2026-10-05): the bullets are
// drawn apart from their words, which also reorders the embedded glyphs, so
// every page's stream changed. A completed document closes with its signing
// certificate (2026-10-17): a fifth page, the first four untouched.
const EXPECTED_CONTENT_STREAM_SHA256: readonly string[] = [
  "d56eb776da576d770761cf52ef0e0d860a71774644784742a8ff426b754717e3",
  "e1fe108f5673deb7f6ffa1c89ebf141618ac4cab1f15b194427d7995cdf1e1fa",
  "cb54b16aca9b44cf9fa6b0b937b736a00bc66426effa810fb000dd1122122ac1",
  "904db9abf1639d5000355b84ba1c9e1613c527a1a0676f58e4bbd26463ff4d7c",
  "0a2030079edafc4ed4776e230755ae8a94b41f375c3f68d74ffaf0c2a8423c2b"
]

// Four pages of text with a few fields and a signature, and the certificate. Whole font files made
// even a one-line document about 0.9 MB; only the glyphs drawn are embedded.
const MAX_SAMPLE_BYTES = 150 * 1024

// Each case embeds fonts and renders a real PDF, which costs seconds rather
// than milliseconds. Vitest runs files in parallel, so on a busy machine the
// stock 5s budget expires mid-render and the failure reads as a changed
// fingerprint — a real PDF regression is exactly what this file exists to
// catch, so a timeout that imitates one is worse than a slow test. Only the
// clock is relaxed here; every assertion is unchanged.
const PDF_RENDER_TIMEOUT_MS = 30_000

describe("generated document PDF fingerprint", () => {
  it("renders byte-identical output for identical input", async () => {
    const [first, second] = await Promise.all([
      renderSample(),
      renderSample()
    ])

    expect(first.equals(second)).toBe(true)
  })

  it("ends a completed document with its signing certificate, and one still being signed without", async () => {
    const sample = createSampleDocumentInput()
    const [completed, awaiting] = await Promise.all([
      renderGeneratedDocumentPdf({ ...sample, metadataTimestamp: FIXED_METADATA_TIMESTAMP }),
      renderGeneratedDocumentPdf({ ...sample, metadataTimestamp: FIXED_METADATA_TIMESTAMP, workflowStatus: "awaiting_signatures" }),
    ])
    const pageCount = async (bytes: Buffer): Promise<number> => (await PDFDocument.load(bytes)).getPageCount()

    expect(await pageCount(completed)).toBe((await pageCount(awaiting)) + 1)
  })

  it("carries a long list of signers on over further certificate pages", async () => {
    const sample = createSampleDocumentInput(FIXED_METADATA_TIMESTAMP)
    const many = Array.from({ length: 40 }, (_, index) => ({ ...sample.signers![0], id: `signer-${index}`, name: `Signer ${index}` }))
    const [one, forty] = await Promise.all([
      renderGeneratedDocumentPdf({ ...sample, signers: [sample.signers![0]] }),
      renderGeneratedDocumentPdf({ ...sample, signers: many }),
    ])
    const pageCount = async (bytes: Buffer): Promise<number> => (await PDFDocument.load(bytes)).getPageCount()

    expect(await pageCount(forty)).toBeGreaterThan((await pageCount(one)) + 1)
  })

  it("keeps page count and geometry stable", async () => {
    const pages = (await loadRendered(await renderSample())).getPages()

    expect(pages).toHaveLength(EXPECTED_PAGE_COUNT)

    for (const page of pages) {
      const { height, width } = page.getSize()

      expect({
        height: Math.round(height),
        width: Math.round(width)
      }).toEqual(EXPECTED_PAGE_SIZE)
    }
  })

  it("keeps every drawn content stream unchanged", async () => {
    const hashes = await fingerprintContentStreams(await renderSample())

    expect(hashes).toEqual(EXPECTED_CONTENT_STREAM_SHA256)
  })

  it("embeds only the glyphs it draws, so the file stays small", async () => {
    expect((await renderSample()).length).toBeLessThan(MAX_SAMPLE_BYTES)
  })

  it("writes the injected metadata timestamp rather than the clock", async () => {
    const document = await loadRendered(await renderSample())
    const expected = new Date(FIXED_METADATA_TIMESTAMP).getTime()

    expect(document.getCreationDate()?.getTime()).toBe(expected)
    expect(document.getModificationDate()?.getTime()).toBe(expected)
  })

  // Not a check: writes the sample out for a person to look at.
  it.runIf(process.env.RENDER_SAMPLE)("writes the sample for eyeballing", async () => {
    const path =
      process.env.RENDER_SAMPLE === "1"
        ? "artifacts/verification/generated-document-sample.pdf"
        : (process.env.RENDER_SAMPLE as string)
    const pdf = await renderSample()

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, pdf)
    console.info("generated_document_visual_sample_written", { path, byteSize: pdf.length })
    expect(pdf.length).toBeGreaterThan(0)
  })
}, PDF_RENDER_TIMEOUT_MS)

/**
 * Renders the shared sample document with a frozen metadata timestamp.
 *
 * @returns Rendered PDF bytes.
 */
async function renderSample(): Promise<Buffer> {
  return renderGeneratedDocumentPdf(
    createSampleDocumentInput(FIXED_METADATA_TIMESTAMP)
  )
}

/**
 * Parses rendered bytes without letting pdf-lib rewrite their metadata.
 *
 * `PDFDocument.load` defaults to `updateMetadata: true`, and that path stamps
 * `ModDate` with the current time from the constructor — before any assertion
 * gets to look at it. Reading the date back therefore requires opting out, or
 * the check silently measures the clock instead of the renderer.
 *
 * @param bytes - Rendered PDF bytes.
 * @returns Parsed document with its metadata exactly as written.
 */
async function loadRendered(bytes: Buffer): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false })
}

/**
 * Hashes the decompressed content stream of every page in order.
 *
 * Decompressing first is what makes the hash meaningful: comparing the raw
 * deflate bytes would fail on any zlib change while the drawn output stayed
 * identical.
 *
 * @param bytes - Rendered PDF bytes.
 * @returns One lowercase SHA-256 hex digest per page, in page order.
 */
async function fingerprintContentStreams(
  bytes: Buffer
): Promise<readonly string[]> {
  const document = await loadRendered(bytes)

  return document.getPages().map((page): string => {
    const contents = page.node.Contents()
    const hash = createHash("sha256")

    // A page's content may be a single stream or an array of streams that the
    // reader concatenates; both are legal PDF and pdf-lib emits either.
    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index += 1) {
        hash.update(decodeStream(document, contents.get(index)))
      }
    } else if (contents !== undefined) {
      hash.update(decodeStream(document, contents))
    }

    return hash.digest("hex")
  })
}

/**
 * Resolves a content entry to its decompressed bytes.
 *
 * @param document - Document the entry belongs to, used to resolve references.
 * @param entry - Either a stream or an indirect reference to one.
 * @returns Decompressed stream contents.
 */
function decodeStream(document: PDFDocument, entry: unknown): Uint8Array {
  const resolved =
    entry instanceof PDFRef ? document.context.lookup(entry) : entry

  if (!(resolved instanceof PDFRawStream)) {
    throw new Error("Page contents did not resolve to a raw stream.")
  }

  return decodePDFRawStream(resolved).decode()
}
