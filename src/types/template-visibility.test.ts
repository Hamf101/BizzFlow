import { describe, expect, it } from "vitest"

import {
  applyVisibleTemplateFieldValue,
  describeVisibilityRule,
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
import { createStructuredAnswerContent } from "@/types/template-answer.test-support"

const CHECKBOX_ID = "70000000-0000-4000-8000-000000000001"
const DROPDOWN_ID = "70000000-0000-4000-8000-000000000002"
const CONDITIONAL_ID = "70000000-0000-4000-8000-000000000003"

describe("template visibility", () => {
  it("shows a field while its several-choice source has the value ticked", () => {
    const content = createStructuredAnswerContent()
    const note = content.blocks[1] as TemplateBlock

    expect(isTemplateBlockVisible(content, note, { tools: ["Ladder", "Drill"] })).toBe(true)
    expect(isTemplateBlockVisible(content, note, { tools: ["Ladder"] })).toBe(false)
    expect(isTemplateBlockVisible(content, note, {})).toBe(false)
    // A single answer where a list belongs reveals nothing.
    expect(isTemplateBlockVisible(content, note, { tools: "Drill" })).toBe(false)
    expect(describeVisibilityRule(content, note)).toBe("Tools includes Drill")
  })

  it("tests any earlier answer: not, answered, more or less than a number, all or any of several, and shows text by them too", () => {
    const id = (n: number): string => `71000000-0000-4000-8000-00000000000${n}`
    const rule = (sourceBlockId: string, operator: string, value?: string | boolean) => ({ sourceBlockId, operator, ...(value === undefined ? {} : { value }) })
    const content = parseTemplateContent({
      ...createV3Root(),
      blocks: [
        { ...textBlock(id(1), "income"), format: "money" },
        { ...textBlock(id(2), "employer") },
        { id: id(3), type: "dropdown_field", fieldKey: "status", label: "Status", required: false, helpText: null, placeholder: null, options: ["Employed", "Retired"] },
        // A paragraph and a heading shown by a rule, as fields are.
        { id: id(4), type: "paragraph", text: "Higher-rate taxpayers read on.", alignment: "left", visibleWhen: rule(id(1), "greater_than", "50000") },
        { id: id(5), type: "heading", text: "Employer details", level: 2, alignment: "left", visibleWhen: rule(id(2), "answered") },
        { ...textBlock(id(6), "why_not"), visibleWhen: { match: "all", conditions: [rule(id(3), "not_equals", "Retired"), rule(id(2), "not_answered")] } },
        { ...textBlock(id(7), "relief"), visibleWhen: { match: "any", conditions: [rule(id(1), "less_than", "12570.50"), rule(id(3), "equals", "Retired")] } },
      ],
    })
    const shown = (answers: Record<string, unknown>): string[] => getVisibleTemplateBlocks(content, answers).slice(3).map((block) => block.id.slice(-1))

    // 60,000 with its comma is more than 50,000; a blank employer is not answered.
    expect(shown({ income: "60,000", employer: "  ", status: "Employed" })).toEqual(["4", "6"])
    expect(shown({ income: "12570.49", employer: "Acme", status: "Employed" })).toEqual(["5", "7"])
    expect(shown({ income: "", status: "Retired" })).toEqual(["7"])
    // Words where a number belongs are neither more nor less.
    expect(shown({ income: "lots", employer: "Acme" })).toEqual(["5"])
    // Removing a paragraph's answers keeps nothing: paragraphs hold none.
    expect(pruneHiddenTemplateFieldValues(content, { income: "1", why_not: "x", relief: "y", employer: "Acme" })).toEqual({ income: "1", employer: "Acme", relief: "y" })
    // Each rule in words, as a blank form prints it above what it shows.
    expect(content.blocks.map((block) => describeVisibilityRule(content, block))).toEqual([
      null,
      null,
      null,
      "income is more than 50,000",
      "employer is answered",
      "Status is not Retired and employer is not answered",
      "income is less than 12,570.50 or Status is Retired",
    ])
  })

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

    expect(templateRequiresVisibleInitials(content, { approved: false }, 1)).toBe(
      false
    )
    expect(templateRequiresVisibleInitials(content, { approved: true }, 1)).toBe(
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
