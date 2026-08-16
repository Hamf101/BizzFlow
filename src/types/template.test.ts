import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  MAX_TEMPLATE_BLOCK_COUNT,
  parseTemplateContent,
  templateContentV3Schema,
  upgradeV2TemplateContentToV3,
  type TemplateContentV2
} from "./template"

const FIRST_BLOCK_ID = "50000000-0000-4000-8000-000000000001"
const SECOND_BLOCK_ID = "50000000-0000-4000-8000-000000000002"
const THIRD_BLOCK_ID = "50000000-0000-4000-8000-000000000003"
const GROUP_ID = "50000000-0000-4000-8000-000000000004"

describe("template content schema", () => {
  it("creates version-three content with current A4 portrait defaults", () => {
    expect(createBlankTemplateContent()).toMatchObject({
      schemaVersion: 3,
      layout: {
        pageSize: "A4",
        orientation: "portrait",
        marginPreset: "standard",
        density: "balanced",
        printedTitle: { mode: "linked" },
        headerPolicy: "first_page",
        footerPolicy: "all_pages",
        pageNumbering: "page_x_of_y"
      },
      sections: [],
      fieldGroups: [],
      blockRules: []
    })
  })

  it("dual-reads immutable version-two content without upgrading it", () => {
    const versionTwo = createVersionTwoContent()
    const parsed = parseTemplateContent(versionTwo)

    expect(parsed).toEqual(versionTwo)
    expect(parsed.schemaVersion).toBe(2)
    expect("layout" in parsed).toBe(false)
  })

  it("upgrades version two explicitly and idempotently at an editable boundary", () => {
    const upgraded = upgradeV2TemplateContentToV3(createVersionTwoContent())

    expect(upgraded).toMatchObject({
      schemaVersion: 3,
      sections: [
        {
          id: FIRST_BLOCK_ID,
          label: "Section 1",
          startBlockId: FIRST_BLOCK_ID,
          pageBreakBefore: false,
          keepTogether: false
        }
      ]
    })
    expect(upgradeV2TemplateContentToV3(upgraded)).toBe(upgraded)
  })

  it("allows an authoring draft dropdown to start without choices", () => {
    const content = createBlankTemplateContent()
    content.blocks.push({
      id: FIRST_BLOCK_ID,
      type: "dropdown_field",
      fieldKey: "department",
      label: "Department",
      required: false,
      helpText: null,
      placeholder: "Select a department",
      options: []
    })
    content.sections.push({
      id: FIRST_BLOCK_ID,
      label: "Section 1",
      startBlockId: FIRST_BLOCK_ID,
      pageBreakBefore: false,
      keepTogether: false
    })

    expect(parseTemplateContent(content).blocks[0]).toMatchObject({
      type: "dropdown_field",
      options: []
    })
  })

  it("accepts exactly 250 canonical document blocks", () => {
    const content = createContentWithParagraphs(MAX_TEMPLATE_BLOCK_COUNT)

    expect(parseTemplateContent(content).blocks).toHaveLength(250)
  })

  it("rejects more than 250 blocks with a clear validation message", () => {
    const content = createContentWithParagraphs(MAX_TEMPLATE_BLOCK_COUNT + 1)

    expect(() => parseTemplateContent(content)).toThrow(
      "Template content cannot contain more than 250 blocks."
    )
  })

  it("accepts ordered sections, contiguous groups, pagination rules, and visibility", () => {
    const content = createConditionalContent()

    expect(templateContentV3Schema.safeParse(content).success).toBe(true)
  })

  it("rejects duplicate structure ids and groups that cross sections", () => {
    const content = createConditionalContent()
    content.sections.push({
      ...content.sections[0],
      startBlockId: THIRD_BLOCK_ID
    })
    content.fieldGroups[0] = {
      ...content.fieldGroups[0],
      endBlockId: THIRD_BLOCK_ID
    }

    const result = templateContentV3Schema.safeParse(content)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Every section must have a unique stable id.",
        "A field group cannot cross a section boundary."
      ])
    )
  })

  it("rejects later, self, or incompatible visibility sources", () => {
    const content = createConditionalContent()
    const source = content.blocks[0]
    const target = content.blocks[1]

    if (
      source?.type !== "checkbox_field" ||
      target?.type !== "dropdown_field"
    ) {
      throw new Error("Expected conditional field fixtures.")
    }

    source.visibleWhen = {
      sourceBlockId: target.id,
      operator: "equals",
      value: "Approved"
    }
    target.visibleWhen = {
      sourceBlockId: target.id,
      operator: "equals",
      value: "Approved"
    }

    const result = templateContentV3Schema.safeParse(content)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "A visibility source must appear before the conditional field.",
        "A field cannot control its own visibility."
      ])
    )
  })
})

function createContentWithParagraphs(
  blockCount: number
): ReturnType<typeof createBlankTemplateContent> {
  const content = createBlankTemplateContent()

  content.blocks = Array.from({ length: blockCount }, (_, index) => ({
    id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    type: "paragraph" as const,
    text: `Paragraph ${index + 1}`,
    alignment: "left" as const
  }))
  content.sections =
    blockCount === 0
      ? []
      : [
          {
            id: content.blocks[0]?.id ?? FIRST_BLOCK_ID,
            label: "Section 1",
            startBlockId: content.blocks[0]?.id ?? FIRST_BLOCK_ID,
            pageBreakBefore: false,
            keepTogether: false
          }
        ]

  return content
}

function createVersionTwoContent(): TemplateContentV2 {
  return {
    schemaVersion: 2,
    branding: {
      organizationName: "",
      logoDataUrl: null,
      logoAlignment: "left",
      logoWidthPercent: 24,
      primaryColor: "#252329",
      accentColor: "#635273"
    },
    blocks: [
      {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "Legacy snapshot",
        alignment: "left"
      }
    ]
  }
}

function createConditionalContent() {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: FIRST_BLOCK_ID,
      type: "checkbox_field",
      fieldKey: "approved",
      label: "Approved",
      required: false,
      helpText: null,
      checkedByDefault: false
    },
    {
      id: SECOND_BLOCK_ID,
      type: "dropdown_field",
      fieldKey: "department",
      label: "Department",
      required: false,
      helpText: null,
      placeholder: null,
      options: ["Sales", "Support"],
      visibleWhen: {
        sourceBlockId: FIRST_BLOCK_ID,
        operator: "equals",
        value: true
      }
    },
    {
      id: THIRD_BLOCK_ID,
      type: "text_field",
      fieldKey: "notes",
      label: "Notes",
      required: false,
      helpText: null,
      placeholder: null,
      multiline: true
    }
  ]
  content.sections = [
    {
      id: FIRST_BLOCK_ID,
      label: "Approval details",
      startBlockId: FIRST_BLOCK_ID,
      pageBreakBefore: false,
      keepTogether: true
    }
  ]
  content.fieldGroups = [
    {
      id: GROUP_ID,
      label: "Approval fields",
      startBlockId: FIRST_BLOCK_ID,
      endBlockId: SECOND_BLOCK_ID,
      columns: 2,
      keepTogether: true
    }
  ]
  content.blockRules = [
    {
      blockId: THIRD_BLOCK_ID,
      pageBreakBefore: true,
      keepWithNext: false
    }
  ]

  return content
}
