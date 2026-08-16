import { createHash } from "node:crypto"

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
 * `pnpm tsx scripts/render-generated-document-sample.tsx out.pdf`, look at it,
 * and update the constant only once you are satisfied the change is the one you
 * intended.
 */

// Any fixed RFC 3339 instant works; this one matches the sample's signing dates
// so the rendered metadata and the visible signature timestamps agree.
const FIXED_METADATA_TIMESTAMP = "2026-07-17T19:30:00.000Z"

const EXPECTED_PAGE_COUNT = 3

// A4 at 72dpi — A4_WIDTH/A4_HEIGHT in document-pdf/constants.ts, rounded.
// Deliberately written out rather than imported: importing the constants would
// make both sides of the assertion move together, so switching the renderer to
// Letter would silently pass.
const EXPECTED_PAGE_SIZE = { height: 842, width: 595 }

const EXPECTED_CONTENT_STREAM_SHA256: readonly string[] = [
  "daebf827f853fd165cc39682934f9b324e64c5217ab5fb93df0c938c7c22d74d",
  "0007774018557b0117dbc3068f8083871de6954aab6fb191d9caf8bb99f4c897",
  "fcfc5f264e9fa33f1b83549e2c82c2f7de10b578a4d4ffe5a6bb596404c4cbad"
]

describe("generated document PDF fingerprint", () => {
  it("renders byte-identical output for identical input", async () => {
    const [first, second] = await Promise.all([
      renderSample(),
      renderSample()
    ])

    expect(first.equals(second)).toBe(true)
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

  it("writes the injected metadata timestamp rather than the clock", async () => {
    const document = await loadRendered(await renderSample())
    const expected = new Date(FIXED_METADATA_TIMESTAMP).getTime()

    expect(document.getCreationDate()?.getTime()).toBe(expected)
    expect(document.getModificationDate()?.getTime()).toBe(expected)
  })
})

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
