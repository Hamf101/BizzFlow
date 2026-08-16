import { describe, expect, it } from "vitest"

import {
  applyVisibleTemplateFieldValue,
  getVisibleTemplateBlocks,
  isTemplateBlockVisible,
  pruneHiddenTemplateFieldValues,
  templateRequiresVisibleInitials
} from "@/types/template-visibility"
import {
  parseTemplateContent,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"

const CHECKBOX_ID = "70000000-0000-4000-8000-000000000001"
const DROPDOWN_ID = "70000000-0000-4000-8000-000000000002"
const CONDITIONAL_ID = "70000000-0000-4000-8000-000000000003"

describe("template visibility", () => {
  it("keeps every version-two block visible", () => {
    const content = createV2Content()
    const block = content.blocks[0] as TemplateBlock

    expect(isTemplateBlockVisible(content, block, {})).toBe(true)
    expect(getVisibleTemplateBlocks(content, {})).toEqual(content.blocks)
  })

  it("uses a missing checkbox answer's declared default", () => {
    const content = createConditionalContent({
      sourceType: "checkbox",
      checkedByDefault: true,
      conditionValue: true
    })
    const target = content.blocks[1] as TemplateBlock

    expect(isTemplateBlockVisible(content, target, {})).toBe(true)
    expect(isTemplateBlockVisible(content, target, { approved: false })).toBe(
      false
    )
  })

  it("treats a missing dropdown answer as an empty string", () => {
    const content = createConditionalContent({
      sourceType: "dropdown",
      conditionValue: "Other"
    })
    const target = content.blocks[1] as TemplateBlock

    expect(isTemplateBlockVisible(content, target, {})).toBe(false)
    expect(
      isTemplateBlockVisible(content, target, { category: "Other" })
    ).toBe(true)
  })

  it("keeps a dependent field hidden when its controller is hidden", () => {
    const content = parseTemplateContent({
      ...createV3Root(),
      blocks: [
        checkboxBlock(CHECKBOX_ID, "enabled", false),
        {
          ...checkboxBlock(DROPDOWN_ID, "approved", true),
          visibleWhen: {
            sourceBlockId: CHECKBOX_ID,
            operator: "equals",
            value: true
          }
        },
        {
          ...textBlock(CONDITIONAL_ID, "details"),
          visibleWhen: {
            sourceBlockId: DROPDOWN_ID,
            operator: "equals",
            value: true
          }
        }
      ],
      sections: [section(CHECKBOX_ID)]
    })
    const target = content.blocks[2] as TemplateBlock

    expect(isTemplateBlockVisible(content, target, {})).toBe(false)
    expect(
      isTemplateBlockVisible(content, target, {
        enabled: true,
        approved: true
      })
    ).toBe(true)
  })

  it("prevents a hidden value from resurrecting when its controller is re-enabled", () => {
    const content = createConditionalContent({
      sourceType: "checkbox",
      checkedByDefault: false,
      conditionValue: true
    })
    const hiddenAnswers = applyVisibleTemplateFieldValue(
      content,
      { approved: true, details: "Private details", legacy: "preserved" },
      "approved",
      false
    )
    const shownAgain = applyVisibleTemplateFieldValue(
      content,
      hiddenAnswers,
      "approved",
      true
    )

    expect(hiddenAnswers).toEqual({ approved: false, legacy: "preserved" })
    expect(shownAgain).toEqual({ approved: true, legacy: "preserved" })
    expect(pruneHiddenTemplateFieldValues(content, shownAgain)).toEqual(
      shownAgain
    )
  })

  it("derives required initials from the live visible answer state", () => {
    const content = parseTemplateContent({
      ...createV3Root(),
      blocks: [
        checkboxBlock(CHECKBOX_ID, "approved", false),
        {
          id: CONDITIONAL_ID,
          type: "initials_field",
          fieldKey: "approval_initials",
          label: "Approval initials",
          required: true,
          helpText: null,
          visibleWhen: {
            sourceBlockId: CHECKBOX_ID,
            operator: "equals",
            value: true
          }
        }
      ],
      sections: [section(CHECKBOX_ID)]
    })

    expect(templateRequiresVisibleInitials(content, { approved: false })).toBe(
      false
    )
    expect(templateRequiresVisibleInitials(content, { approved: true })).toBe(
      true
    )
  })
})

function createV2Content(): TemplateContent {
  return parseTemplateContent({
    schemaVersion: 2,
    branding: {},
    blocks: [textBlock(CONDITIONAL_ID, "details")]
  })
}

function createConditionalContent(input:
  | {
      sourceType: "checkbox"
      checkedByDefault: boolean
      conditionValue: boolean
    }
  | {
      sourceType: "dropdown"
      conditionValue: string
    }): TemplateContent {
  const source =
    input.sourceType === "checkbox"
      ? checkboxBlock(CHECKBOX_ID, "approved", input.checkedByDefault)
      : {
          id: DROPDOWN_ID,
          type: "dropdown_field" as const,
          fieldKey: "category",
          label: "Category",
          required: false,
          helpText: null,
          placeholder: null,
          options: ["Standard", "Other"]
        }
  const target = {
    ...textBlock(CONDITIONAL_ID, "details"),
    visibleWhen: {
      sourceBlockId: source.id,
      operator: "equals" as const,
      value: input.conditionValue
    }
  }

  return parseTemplateContent({
    ...createV3Root(),
    blocks: [source, target],
    sections: [section(source.id)]
  })
}

function createV3Root(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    branding: {},
    layout: {},
    sections: [],
    fieldGroups: [],
    blockRules: []
  }
}

/** Loosely typed fixture block that still exposes a narrowed, referencable id. */
type FixtureBlock = Record<string, unknown> & { id: string }

function checkboxBlock(
  id: string,
  fieldKey: string,
  checkedByDefault: boolean
): FixtureBlock {
  return {
    id,
    type: "checkbox_field",
    fieldKey,
    label: fieldKey,
    required: false,
    helpText: null,
    checkedByDefault
  }
}

function textBlock(id: string, fieldKey: string): FixtureBlock {
  return {
    id,
    type: "text_field",
    fieldKey,
    label: fieldKey,
    required: false,
    helpText: null,
    placeholder: null,
    multiline: false
  }
}

function section(startBlockId: string): Record<string, unknown> {
  return {
    id: "70000000-0000-4000-8000-000000000010",
    label: "Section 1",
    startBlockId,
    pageBreakBefore: false,
    keepTogether: false
  }
}
