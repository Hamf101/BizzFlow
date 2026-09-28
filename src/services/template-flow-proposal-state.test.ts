import { describe, expect, it } from "vitest"

import { createTemplateFlowDraftFingerprint } from "@/services/template-flow-proposal-state"
import { createBlankTemplateContent } from "@/types/template"
import type { TemplateFlowDraft } from "@/types/template-flow"

describe("template Flow draft fingerprint", () => {
  it("tells an edited draft apart, so a proposal made before the edit is stale", () => {
    expect(createTemplateFlowDraftFingerprint(createDraft("Edited"))).not.toBe(
      createTemplateFlowDraftFingerprint(createDraft("Original"))
    )
  })

  it("identifies a draft by what Flow reads, so the editor's own fields never make a proposal look stale", () => {
    const draft = createDraft("Original")
    const editorState = { ...draft, category: "Operations" }

    expect(createTemplateFlowDraftFingerprint(editorState)).toBe(
      createTemplateFlowDraftFingerprint(draft)
    )
  })

  it("fingerprints equivalent object key orders identically", () => {
    const draft = createDraft("Original")
    const reorderedDraft = {
      content: draft.content,
      description: draft.description,
      title: draft.title
    }

    expect(createTemplateFlowDraftFingerprint(reorderedDraft)).toBe(
      createTemplateFlowDraftFingerprint(draft)
    )
  })
})

function createDraft(title: string): TemplateFlowDraft {
  return {
    title,
    description: "Reusable template",
    content: createBlankTemplateContent()
  }
}
