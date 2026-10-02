import { PDFDocument } from "pdf-lib"
import * as Y from "yjs"
import { describe, expect, it } from "vitest"

import { createWorkingCopyDoc } from "@/lib/collaboration/working-copy-doc"
import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createLongDocumentContent } from "@/types/long-document.test-support"
import { templateContentV3Schema } from "@/types/template"

// The room refuses one update over 1 MiB, and a room opens in one response
// under the platform's 4.5 MB cap, sent as base64.
const MAX_ROOM_UPDATE_BYTES = 1_048_576
const MAX_ROOM_STATE_BYTES = 3_300_000

describe("a 50-page document", () => {
  it("saves, prints, and opens in a shared room whole", { timeout: 120_000 }, async () => {
    const content = createLongDocumentContent()

    expect(templateContentV3Schema.safeParse(content).success).toBe(true)

    const pdf = await PDFDocument.load(
      await renderGeneratedDocumentPdf({ answers: {}, content, documentId: "long-document", signers: [], title: "Master services agreement", workflowStatus: "draft" })
    )

    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(50)

    // Written into a room in one go, as a restore or an outside change is.
    const state = Y.encodeStateAsUpdate(createWorkingCopyDoc({ content, title: "Master services agreement" }))

    expect(state.byteLength).toBeLessThan(MAX_ROOM_UPDATE_BYTES)
    expect(state.byteLength).toBeLessThan(MAX_ROOM_STATE_BYTES)
  })
})
