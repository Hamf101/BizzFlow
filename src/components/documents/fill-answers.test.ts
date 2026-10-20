import { describe, expect, it } from "vitest"

import { createBlankTemplateContent, upgradeV2TemplateContentToV3 } from "@/types/template"

import { mergeFilledAnswers, whyNotFill } from "./fill-answers"

describe("answers filled in from a form", () => {
  it("shows what the server holds, but keeps what the member typed or cleared while the fill was on its way", () => {
    const before = { client_name: "", notes: "Call first", phone: "555 0100" }
    // Typed, and cleared, after the answers were saved and the fill had left.
    const current = { client_name: "", notes: "Call after 5", phone: undefined }
    const filled = { client_name: "Ada Lovelace", notes: "Call first", phone: "555 0100", total: 12 }

    expect(mergeFilledAnswers(before, current, filled)).toEqual({ client_name: "Ada Lovelace", notes: "Call after 5", total: 12 })
  })
})

describe("whether a form's answers can be filled in now", () => {
  const content = upgradeV2TemplateContentToV3(createBlankTemplateContent())
  const unlabelled = {
    ...content,
    blocks: [{ fieldKey: "client_name", helpText: null, id: "50000000-0000-4000-8000-000000000001", label: "", multiline: false, placeholder: null, required: false, type: "text_field" as const }],
  }

  it("refuses a page that wouldn't save as it stands, so no answer is lost on a field the server never got", () => {
    expect(whyNotFill({ content: unlabelled, title: "Intake" })).toBe("Fix the problems on the page first.")
    expect(whyNotFill({ content, title: " " })).toBe("Fix the problems on the page first.")
    expect(whyNotFill({ content, title: "Intake" }, { problems: 2 })).toBe("Fix the problems on the page first.")
  })

  it("never saves past what the member chose to keep on this device, and waits for the checks", () => {
    expect(whyNotFill({ content, title: "Intake" }, { unsavedByChoice: true })).toBe("Save your changes first.")
    expect(whyNotFill({ content, title: "Intake" }, { checking: true })).toBe("Checking the template. Try again in a moment.")
    expect(whyNotFill({ content, title: "Intake" })).toBeNull()
  })
})
