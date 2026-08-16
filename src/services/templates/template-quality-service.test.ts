import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  parseTemplateContent,
  type TemplateBlock,
  type TemplateContent
} from "@/types/template"

import {
  evaluateTemplateQuality,
  hasBlockingTemplateQualityIssues,
  isTemplateQualityIssueSaveBlocking,
  summarizeTemplateQuality,
  type TemplateQualityIssue
} from "./template-quality-service"

const FIRST_BLOCK_ID = "51000000-0000-4000-8000-000000000001"
const SECOND_BLOCK_ID = "51000000-0000-4000-8000-000000000002"
const THIRD_BLOCK_ID = "51000000-0000-4000-8000-000000000003"

describe("evaluateTemplateQuality", () => {
  it("reports empty content and a missing description with a blocking summary", () => {
    const result = evaluateTemplateQuality({
      title: "Client intake",
      content: createBlankTemplateContent()
    })

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "empty_content",
      "missing_description"
    ])
    expect(result.summary).toEqual({
      totalCount: 2,
      criticalCount: 1,
      warningCount: 1,
      isBlocking: true
    })
  })

  it("returns no issues for a small usable version-two template", () => {
    const content = createVersionTwoContent([
      {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "Use this form to collect the requested client details.",
        alignment: "left"
      }
    ])

    const result = evaluateTemplateQuality({
      title: "Client intake",
      description: "Collects the details needed to onboard a client.",
      content
    })

    expect(result).toEqual({
      issues: [],
      summary: {
        totalCount: 0,
        criticalCount: 0,
        warningCount: 0,
        isBlocking: false
      }
    })
  })

  it("finds visible unresolved markers in metadata and block text", () => {
    const content = createVersionTwoContent([
      {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "Needs input: confirm the cancellation period.",
        alignment: "left"
      },
      {
        id: SECOND_BLOCK_ID,
        type: "text_field",
        fieldKey: "client_name",
        label: "Client name",
        required: true,
        helpText: "NEEDS INPUT: clarify whether a legal name is required.",
        placeholder: null,
        multiline: false
      }
    ])

    const result = evaluateTemplateQuality({
      title: "Needs input: name this intake",
      description: "Collects onboarding details.",
      content
    })

    expect(result.issues).toContainEqual({
      code: "unresolved_needs_input",
      severity: "critical",
      message:
        'Resolve every visible "Needs input:" marker before this template is ready to use.',
      affectedBlockIds: [FIRST_BLOCK_ID, SECOND_BLOCK_ID]
    })
  })

  it("checks dropdown choice distinctness and obvious placeholder choices", () => {
    const content = createVersionTwoContent([
      createDropdown(FIRST_BLOCK_ID, "Department", [
        "Sales",
        " sales "
      ]),
      createDropdown(SECOND_BLOCK_ID, "Approval outcome", [
        "Option 1",
        "Choice #2"
      ])
    ])

    const result = evaluateTemplateQuality({
      title: "Request review",
      description: "Captures a request review outcome.",
      content
    })

    expect(result.issues).toEqual([
      {
        code: "dropdown_insufficient_choices",
        severity: "critical",
        message: "Dropdown fields need at least two distinct choices.",
        affectedBlockIds: [FIRST_BLOCK_ID]
      },
      {
        code: "dropdown_placeholder_choices",
        severity: "critical",
        message: "Replace placeholder dropdown choices with meaningful options.",
        affectedBlockIds: [SECOND_BLOCK_ID]
      }
    ])
  })

  it("flags only known generic starter labels", () => {
    const content = createVersionTwoContent([
      {
        id: FIRST_BLOCK_ID,
        type: "text_field",
        fieldKey: "text_field",
        label: "Text field",
        required: false,
        helpText: null,
        placeholder: null,
        multiline: false
      },
      {
        id: SECOND_BLOCK_ID,
        type: "date_field",
        fieldKey: "effective_date",
        label: "Effective date",
        required: true,
        helpText: null
      }
    ])

    const result = evaluateTemplateQuality({
      title: "Agreement details",
      description: "Collects agreement details.",
      content
    })

    expect(result.issues).toEqual([
      {
        code: "generic_field_label",
        severity: "critical",
        message:
          "Replace generic field labels with labels that explain what to enter.",
        affectedBlockIds: [FIRST_BLOCK_ID]
      }
    ])
  })

  it("treats non-snake-case keys as a warning in v2 and critical in v3", () => {
    const blocks: TemplateBlock[] = [
      {
        id: FIRST_BLOCK_ID,
        type: "text_field",
        fieldKey: "Client-Name",
        label: "Client name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      }
    ]
    const versionTwoResult = evaluateTemplateQuality({
      title: "Client intake",
      description: "Collects a client's name.",
      content: createVersionTwoContent(blocks)
    })
    const versionThreeResult = evaluateTemplateQuality({
      title: "Client intake",
      description: "Collects a client's name.",
      content: createVersionThreeContent(blocks)
    })

    expect(findIssue(versionTwoResult.issues, "invalid_field_key").severity).toBe(
      "warning"
    )
    expect(
      findIssue(versionThreeResult.issues, "invalid_field_key").severity
    ).toBe("critical")
  })

  it("uses schema-sensitive title duplication severity and finds heading jumps", () => {
    const blocks: TemplateBlock[] = [
      {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "  Service   Agreement ",
        level: 1,
        alignment: "left"
      },
      {
        id: SECOND_BLOCK_ID,
        type: "heading",
        text: "Scope",
        level: 3,
        alignment: "left"
      },
      {
        id: THIRD_BLOCK_ID,
        type: "heading",
        text: "Details",
        level: 3,
        alignment: "left"
      }
    ]
    const versionTwoResult = evaluateTemplateQuality({
      title: "service agreement",
      description: "Defines the service scope.",
      content: createVersionTwoContent(blocks)
    })
    const versionThreeResult = evaluateTemplateQuality({
      title: "service agreement",
      description: "Defines the service scope.",
      content: createVersionThreeContent(blocks)
    })

    expect(
      findIssue(versionTwoResult.issues, "duplicate_title_heading")
    ).toMatchObject({
      severity: "warning",
      affectedBlockIds: [FIRST_BLOCK_ID]
    })
    expect(
      findIssue(versionThreeResult.issues, "duplicate_title_heading")
    ).toMatchObject({
      severity: "critical",
      affectedBlockIds: [FIRST_BLOCK_ID]
    })
    expect(
      findIssue(versionThreeResult.issues, "heading_level_jump")
    ).toMatchObject({
      severity: "warning",
      affectedBlockIds: [SECOND_BLOCK_ID]
    })
  })

  it("checks duplicate headings against the resolved custom printed title", () => {
    const content = createVersionThreeContent([
      {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "Metadata agreement",
        level: 1,
        alignment: "left"
      },
      {
        id: SECOND_BLOCK_ID,
        type: "heading",
        text: "Printed client agreement",
        level: 1,
        alignment: "left"
      }
    ])

    if (content.schemaVersion !== 3) {
      throw new Error("Expected a version-three quality fixture.")
    }

    content.layout = {
      ...content.layout,
      printedTitle: { mode: "custom", text: "Printed client agreement" }
    }

    const result = evaluateTemplateQuality({
      title: "Metadata agreement",
      description: "Defines the client agreement.",
      content
    })

    expect(findIssue(result.issues, "duplicate_title_heading")).toMatchObject({
      severity: "critical",
      affectedBlockIds: [SECOND_BLOCK_ID]
    })
  })

  it("blocks blank metadata and every visible heading or label", () => {
    const content = createVersionThreeContent([
      {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "Client details",
        level: 2,
        alignment: "left"
      },
      {
        id: SECOND_BLOCK_ID,
        type: "text_field",
        fieldKey: "client_name",
        label: "Client name",
        required: true,
        helpText: null,
        placeholder: null,
        multiline: false
      }
    ])

    if (content.schemaVersion !== 3) {
      throw new Error("Expected a version-three quality fixture.")
    }

    const heading = content.blocks[0]
    const field = content.blocks[1]

    if (heading?.type !== "heading" || field?.type !== "text_field") {
      throw new Error("Expected heading and field quality fixtures.")
    }

    heading.text = "   "
    field.label = ""
    content.sections[0]!.label = " "
    content.fieldGroups = [
      {
        id: THIRD_BLOCK_ID,
        label: "",
        startBlockId: SECOND_BLOCK_ID,
        endBlockId: SECOND_BLOCK_ID,
        columns: 1,
        keepTogether: false
      }
    ]
    content.layout.printedTitle = { mode: "custom", text: " " }

    const result = evaluateTemplateQuality({
      title: "   ",
      description: "Collects client details.",
      content
    })

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "missing_title",
      "blank_heading",
      "blank_field_label",
      "blank_section_label",
      "blank_field_group_label",
      "blank_custom_printed_title"
    ])
    expect(result.summary).toEqual({
      totalCount: 6,
      criticalCount: 6,
      warningCount: 0,
      isBlocking: true
    })
    expect(result.issues.every(isTemplateQualityIssueSaveBlocking)).toBe(true)
  })

  it("reports schema-invalid content not covered by visible label checks", () => {
    const content = createVersionThreeContent([
      {
        id: FIRST_BLOCK_ID,
        type: "bullet_list",
        items: ["Requested service"]
      }
    ])
    const list = content.blocks[0]

    if (list?.type !== "bullet_list") {
      throw new Error("Expected a bullet-list quality fixture.")
    }

    list.items = [""]

    const result = evaluateTemplateQuality({
      title: "Client intake",
      description: "Collects client details.",
      content
    })

    expect(findIssue(result.issues, "invalid_template_content")).toMatchObject({
      severity: "critical",
      affectedBlockIds: [FIRST_BLOCK_ID]
    })
  })

  it("enforces the server metadata length limits in the shared evaluation", () => {
    const content = createVersionTwoContent([
      {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "Collect the requested client details.",
        alignment: "left"
      }
    ])

    const result = evaluateTemplateQuality({
      title: "T".repeat(181),
      description: "D".repeat(2_001),
      content
    })

    expect(findIssue(result.issues, "invalid_template_metadata")).toMatchObject({
      severity: "critical",
      affectedBlockIds: []
    })
  })

  it("does not mutate the supplied template content", () => {
    const content = createVersionTwoContent([
      createDropdown(FIRST_BLOCK_ID, "Department", ["Sales", "Support"])
    ])
    const originalContent = structuredClone(content)

    evaluateTemplateQuality({
      title: "Department request",
      description: "Routes a request to one department.",
      content
    })

    expect(content).toEqual(originalContent)
  })
})

describe("template quality helpers", () => {
  it("summarizes and identifies blocking issues", () => {
    const issues: TemplateQualityIssue[] = [
      {
        code: "empty_content",
        severity: "critical",
        message: "Add content.",
        affectedBlockIds: []
      },
      {
        code: "missing_description",
        severity: "warning",
        message: "Add a description.",
        affectedBlockIds: []
      }
    ]

    expect(summarizeTemplateQuality(issues)).toEqual({
      totalCount: 2,
      criticalCount: 1,
      warningCount: 1,
      isBlocking: true
    })
    expect(hasBlockingTemplateQualityIssues(issues)).toBe(true)
    expect(hasBlockingTemplateQualityIssues(issues.slice(1))).toBe(false)
    expect(isTemplateQualityIssueSaveBlocking(issues[0]!)).toBe(false)
    expect(
      isTemplateQualityIssueSaveBlocking({
        code: "missing_title",
        severity: "critical",
        message: "Add a title.",
        affectedBlockIds: []
      })
    ).toBe(true)
  })
})

function createVersionTwoContent(
  blocks: TemplateBlock[]
): TemplateContent {
  const blankContent = createBlankTemplateContent()

  return parseTemplateContent({
    schemaVersion: 2,
    branding: blankContent.branding,
    blocks
  })
}

function createVersionThreeContent(
  blocks: TemplateBlock[]
): TemplateContent {
  const versionTwoContent = createBlankTemplateContent()

  return parseTemplateContent({
    schemaVersion: 3,
    branding: versionTwoContent.branding,
    blocks,
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
    sections:
      blocks.length === 0
        ? []
        : [
            {
              id: blocks[0]?.id,
              label: "Section 1",
              startBlockId: blocks[0]?.id,
              pageBreakBefore: false,
              keepTogether: false
            }
          ],
    fieldGroups: [],
    blockRules: []
  })
}

function createDropdown(
  id: string,
  label: string,
  options: string[]
): TemplateBlock {
  return {
    id,
    type: "dropdown_field",
    fieldKey: `${label.toLowerCase().replaceAll(" ", "_")}_choice`,
    label,
    required: true,
    helpText: null,
    placeholder: `Select ${label.toLowerCase()}`,
    options
  }
}

function findIssue(
  issues: readonly TemplateQualityIssue[],
  code: TemplateQualityIssue["code"]
): TemplateQualityIssue {
  const issue = issues.find(
    (candidate: TemplateQualityIssue): boolean => candidate.code === code
  )

  if (issue === undefined) {
    throw new Error(`Expected quality issue "${code}".`)
  }

  return issue
}
