import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { renderGeneratedDocumentPdf } from "@/services/document-pdf-service"
import { createPdfPagePlans } from "@/services/document-pdf/planner"
import { normalizePdfInput } from "@/services/document-pdf/shared"
import { evaluateTemplateQuality } from "@/services/templates/template-quality-service"
import { templateContentV3Schema, type TemplateContentV3 } from "@/types/template"

/**
 * The gold references: the best intake form, quote and service agreement this
 * editor can produce. `tuning/` is shown to the model as examples; `heldout/`
 * never is, so a draft can be compared against it fairly.
 *
 *   FLOW_BENCH=1 pnpm vitest run scripts/flow-bench/references.test.ts
 *
 * renders each one to artifacts/flow-bench/references/<set>/<name>.pdf.
 */

type Reference = {
  set: string
  name: string
  title: string
  description: string
  content: TemplateContentV3
}

const ROOT = "scripts/flow-bench/references"
const DOCUMENT_ID = "a0000000-0000-4000-8000-000000000000"
const METADATA_TIMESTAMP = "2026-01-01T00:00:00.000Z"

function readReferences(): Reference[] {
  return ["tuning", "heldout"].flatMap((set: string) =>
    readdirSync(join(ROOT, set))
      .filter((file: string) => file.endsWith(".json"))
      .map((file: string): Reference => {
        const { title, description, content } = JSON.parse(readFileSync(join(ROOT, set, file), "utf8")) as Reference

        return { set, name: file.slice(0, -5), title, description, content }
      })
  )
}

describe("Flow references", () => {
  it("are valid, free of quality issues and no longer than four pages", () => {
    const references = readReferences()

    expect(references.map(({ set, name }: Reference) => `${set}/${name}`).sort()).toEqual([
      "heldout/agreement",
      "heldout/intake",
      "heldout/quote",
      "tuning/agreement",
      "tuning/intake",
      "tuning/quote",
    ])

    for (const { set, name, title, description, content } of references) {
      const where = `${set}/${name}`
      const parsed = templateContentV3Schema.parse(content)
      const pages = createPdfPagePlans(
        normalizePdfInput({ answers: {}, content: parsed, documentId: DOCUMENT_ID, title, workflowStatus: "draft" })
      )

      expect(evaluateTemplateQuality({ title, description, content: parsed }).issues, where).toEqual([])
      expect(pages.length, where).toBeGreaterThan(0)
      expect(pages.length, where).toBeLessThanOrEqual(5)
    }
  })

  it.runIf(process.env.FLOW_BENCH === "1")("render to PDF", async () => {
    for (const { set, name, title, content } of readReferences()) {
      const outDir = join("artifacts/flow-bench/references", set)
      const pdf = await renderGeneratedDocumentPdf({
        answers: {},
        content,
        documentId: DOCUMENT_ID,
        metadataTimestamp: METADATA_TIMESTAMP,
        title,
        workflowStatus: "draft",
      })

      mkdirSync(outDir, { recursive: true })
      writeFileSync(join(outDir, `${name}.pdf`), pdf)
      expect(pdf.byteLength, `${set}/${name}`).toBeGreaterThan(0)
    }
  }, 120_000)
})
