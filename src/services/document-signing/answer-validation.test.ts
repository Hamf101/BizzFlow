import { describe, expect, it } from "vitest"

import {
  assertRequiredAnswersComplete,
  collectFields,
  normalizeAnswerPatch,
  pruneHiddenAnswerPatch,
  pruneHiddenAnswerValues,
  templateRequiresRecipientInitials
} from "@/services/document-signing/answer-validation"
import { parseTemplateContent, type TemplateContent } from "@/types/template"

const CONTENT = createConditionalContent()

describe("document signing answer visibility", () => {
  it("keeps Other details only while the dropdown condition is active", async () => {
    const fields = collectFields(CONTENT)
    const patch = await normalizeAnswerPatch(fields, {
      category: "Other",
      other_details: "Custom category"
    })

    expect(pruneHiddenAnswerPatch(CONTENT, {}, patch)).toEqual(patch)
    expect(
      pruneHiddenAnswerPatch(CONTENT, {}, {
        category: "Standard",
        other_details: "Stale detail"
      })
    ).toEqual({ category: "Standard" })
  })

  it("prunes stale checkbox-dependent values before and after a patch", () => {
    expect(
      pruneHiddenAnswerValues(CONTENT, {
        include_details: false,
        approval_details: "Stale detail"
      })
    ).toEqual({ include_details: false })

    expect(
      pruneHiddenAnswerPatch(
        CONTENT,
        { include_details: true, approval_details: "Prior detail" },
        { include_details: false, approval_details: "Submitted stale detail" }
      )
    ).toEqual({ include_details: false })
  })

  it("validates hidden submitted values before pruning them", async () => {
    await expect(
      normalizeAnswerPatch(collectFields(CONTENT), {
        include_details: false,
        approval_details: false
      })
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("requires only visible fields in the effective merged answer set", () => {
    const fields = collectFields(CONTENT)

    expect(() =>
      assertRequiredAnswersComplete(
        CONTENT,
        fields,
        { include_details: false, category: "Standard" },
        true
      )
    ).not.toThrow()

    expect(() =>
      assertRequiredAnswersComplete(
        CONTENT,
        fields,
        { include_details: true, category: "Standard" },
        true
      )
    ).toThrow("Approval details must be completed")
  })

  it("requires recipient initials only while the initials block is visible", () => {
    expect(
      templateRequiresRecipientInitials(CONTENT, { include_details: false })
    ).toBe(false)
    expect(
      templateRequiresRecipientInitials(CONTENT, { include_details: true })
    ).toBe(true)
  })
})

function createConditionalContent(): TemplateContent {
  const dropdownId = "92000000-0000-4000-8000-000000000001"
  const checkboxId = "92000000-0000-4000-8000-000000000002"

  return parseTemplateContent({
    schemaVersion: 3,
    branding: {},
    layout: {},
    sections: [],
    fieldGroups: [],
    blockRules: [],
    blocks: [
      {
        id: dropdownId,
        type: "dropdown_field",
        fieldKey: "category",
        label: "Category",
        required: false,
        helpText: null,
        placeholder: null,
        options: ["Standard", "Other"]
      },
      {
        id: checkboxId,
        type: "checkbox_field",
        fieldKey: "include_details",
        label: "Include details",
        required: false,
        helpText: null,
        checkedByDefault: false
      },
      {
        id: "92000000-0000-4000-8000-000000000003",
        type: "text_field",
        fieldKey: "other_details",
        label: "Please specify category",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false,
        visibleWhen: {
          sourceBlockId: dropdownId,
          operator: "equals",
          value: "Other"
        }
      },
      {
        id: "92000000-0000-4000-8000-000000000004",
        type: "text_field",
        fieldKey: "approval_details",
        label: "Approval details",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: true,
        visibleWhen: {
          sourceBlockId: checkboxId,
          operator: "equals",
          value: true
        }
      },
      {
        id: "92000000-0000-4000-8000-000000000005",
        type: "initials_field",
        fieldKey: "approval_initials",
        label: "Approval initials",
        required: true,
        helpText: null,
        visibleWhen: {
          sourceBlockId: checkboxId,
          operator: "equals",
          value: true
        }
      }
    ]
  })
}
