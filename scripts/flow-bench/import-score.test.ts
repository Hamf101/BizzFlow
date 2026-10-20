import { describe, expect, it } from "vitest"

import { createEmptyDocumentContent, type TemplateBlock, type TemplateContentV3 } from "@/types/template"

import { scoreImport } from "./import-score"

const text = (fieldKey: string, label: string): TemplateBlock =>
  ({ id: crypto.randomUUID(), type: "text_field", fieldKey, label, required: false, helpText: null, placeholder: null, multiline: false }) as TemplateBlock

function content(blocks: TemplateBlock[], sections: string[], pageSize: "A4" | "Letter" = "A4"): TemplateContentV3 {
  const empty = createEmptyDocumentContent()

  return {
    ...empty,
    blocks,
    layout: { ...empty.layout, pageSize },
    sections: sections.map((label, at) => ({ id: crypto.randomUUID(), label, startBlockId: blocks[at]!.id, pageBreakBefore: false, keepTogether: false })),
  }
}

describe("scoreImport", () => {
  it("matches labels loosely but never a part for the whole, and counts right, wrong and invented answers", () => {
    const reference = content([text("name", "Name"), text("email", "Email address"), text("dob", "Date of birth"), text("notes", "Notes")], ["You", "More"])
    const date = { ...text("born", "Date of birth"), type: "date_field" } as TemplateBlock
    const result = content([text("biz", "Business name"), text("mail", "Email address:"), date, text("notes_2", "notes")], ["More", "You"], "Letter")

    const score = scoreImport({
      reference,
      result,
      truth: { email: "a@b.co", dob: "1990-01-02" },
      answers: { mail: " A@B.co ", born: "1990-02-01", notes_2: "made up", biz: "Acme" },
    })

    expect(score).toMatchObject({ matched: 3, recall: 0.75, precision: 0.75, kindAccuracy: 2 / 3, page: { match: false } })
    expect(score.sections).toEqual({ ref: 2, result: 2, matched: 2, inOrder: false })
    expect(score.answers).toMatchObject({ truth: 2, correct: 1, hallucinated: 1, unmatched: 1 })
  })
})
