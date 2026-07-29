import { describe, expect, it } from "vitest"

import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  getTemplateSectionForBlock,
  insertTemplateBlock,
  moveTemplateBlock,
  moveTemplateBlockAfter,
  updateTemplateBlock
} from "./template-structure"
import {
  createBlankTemplateContent,
  templateContentV3Schema,
  type TemplateContentV3
} from "./template"

const SOURCE_ID = "60000000-0000-4000-8000-000000000001"
const TARGET_ID = "60000000-0000-4000-8000-000000000002"
const THIRD_FIELD_ID = "60000000-0000-4000-8000-000000000003"
const SECOND_SECTION_BLOCK_ID = "60000000-0000-4000-8000-000000000004"
const INSERTED_ID = "60000000-0000-4000-8000-000000000005"
const FIRST_SECTION_ID = "60000000-0000-4000-8000-000000000011"
const SECOND_SECTION_ID = "60000000-0000-4000-8000-000000000012"
const GROUP_ID = "60000000-0000-4000-8000-000000000021"

describe("template structure helpers", () => {
  it("inserts at the beginning without creating a second ordering source", () => {
    const content = createStructuredContent()
    const inserted = insertTemplateBlock(content, null, {
      id: INSERTED_ID,
      type: "paragraph",
      text: "Introduction",
      alignment: "left"
    })

    expect(inserted.blocks.map((block) => block.id)).toEqual([
      INSERTED_ID,
      SOURCE_ID,
      TARGET_ID,
      THIRD_FIELD_ID,
      SECOND_SECTION_BLOCK_ID
    ])
    expect(inserted.sections[0]).toMatchObject({
      id: FIRST_SECTION_ID,
      label: "Approval details",
      startBlockId: INSERTED_ID
    })
    expect(inserted.fieldGroups[0]).toMatchObject({
      id: GROUP_ID,
      startBlockId: SOURCE_ID,
      endBlockId: THIRD_FIELD_ID
    })
    expect(templateContentV3Schema.safeParse(inserted).success).toBe(true)
  })

  it("drops a group made noncontiguous while retaining unaffected references", () => {
    const inserted = insertTemplateBlock(
      createStructuredContent(),
      SOURCE_ID,
      {
        id: INSERTED_ID,
        type: "divider"
      }
    )

    expect(inserted.fieldGroups).toEqual([])
    expect(inserted.blockRules).toEqual([
      {
        blockId: TARGET_ID,
        pageBreakBefore: false,
        keepWithNext: true
      }
    ])
    expect(templateContentV3Schema.safeParse(inserted).success).toBe(true)
  })

  it("repairs section and group boundaries and invalid visibility after a move", () => {
    const moved = moveTemplateBlock(
      createStructuredContent(),
      SOURCE_ID,
      "down"
    )
    const movedTarget = moved.blocks[0]

    expect(moved.sections[0]).toMatchObject({
      id: FIRST_SECTION_ID,
      startBlockId: TARGET_ID
    })
    expect(moved.fieldGroups[0]).toMatchObject({
      id: GROUP_ID,
      startBlockId: TARGET_ID,
      endBlockId: THIRD_FIELD_ID
    })
    expect(movedTarget).not.toHaveProperty("visibleWhen")
    expect(templateContentV3Schema.safeParse(moved).success).toBe(true)
  })

  it("repairs positional structure after an arbitrary move", () => {
    const moved = moveTemplateBlockAfter(
      createStructuredContent(),
      SECOND_SECTION_BLOCK_ID,
      SOURCE_ID
    )

    expect(moved.blocks.map((block) => block.id)).toEqual([
      SOURCE_ID,
      SECOND_SECTION_BLOCK_ID,
      TARGET_ID,
      THIRD_FIELD_ID
    ])
    expect(moved.sections).toEqual([
      {
        id: FIRST_SECTION_ID,
        label: "Approval details",
        startBlockId: SOURCE_ID,
        pageBreakBefore: false,
        keepTogether: true
      },
      {
        id: SECOND_SECTION_ID,
        label: "Terms",
        startBlockId: THIRD_FIELD_ID,
        pageBreakBefore: true,
        keepTogether: false
      }
    ])
    expect(moved.fieldGroups).toEqual([])
    expect(templateContentV3Schema.safeParse(moved).success).toBe(true)
  })

  it("shrinks ranges and removes dangling conditions and rules on delete", () => {
    const withoutSource = deleteTemplateBlock(
      createStructuredContent(),
      SOURCE_ID
    )
    const target = withoutSource.blocks[0]

    expect(target).not.toHaveProperty("visibleWhen")
    expect(withoutSource.fieldGroups[0]).toMatchObject({
      id: GROUP_ID,
      startBlockId: TARGET_ID,
      endBlockId: THIRD_FIELD_ID
    })

    const withoutRuleTarget = deleteTemplateBlock(withoutSource, TARGET_ID)

    expect(withoutRuleTarget.blockRules).toEqual([])
    expect(templateContentV3Schema.safeParse(withoutRuleTarget).success).toBe(
      true
    )
  })

  it("retains the following stable section when a singleton section is deleted", () => {
    const content = createStructuredContent()
    content.sections = [
      {
        id: FIRST_SECTION_ID,
        label: "First section",
        startBlockId: SOURCE_ID,
        pageBreakBefore: false,
        keepTogether: false
      },
      {
        id: SECOND_SECTION_ID,
        label: "Following section",
        startBlockId: TARGET_ID,
        pageBreakBefore: true,
        keepTogether: true
      }
    ]
    content.fieldGroups = [
      {
        id: GROUP_ID,
        label: "Following fields",
        startBlockId: TARGET_ID,
        endBlockId: THIRD_FIELD_ID,
        columns: 2,
        keepTogether: true
      }
    ]

    const deleted = deleteTemplateBlock(content, SOURCE_ID)

    expect(deleted.sections[0]).toEqual({
      id: SECOND_SECTION_ID,
      label: "Following section",
      startBlockId: TARGET_ID,
      pageBreakBefore: true,
      keepTogether: true
    })
    expect(getTemplateSectionForBlock(deleted, THIRD_FIELD_ID)?.id).toBe(
      SECOND_SECTION_ID
    )
    expect(templateContentV3Schema.safeParse(deleted).success).toBe(true)
  })

  it("standardizes new keys case-insensitively without renaming stable keys", () => {
    const content = createStructuredContent()

    expect(
      createUniqueTemplateFieldKey("Approval status", content.blocks)
    ).toBe("approval_status_2")

    const target = content.blocks[1]

    if (target?.type !== "text_field") {
      throw new Error("Expected a text field fixture.")
    }

    const labelOnlyEdit = updateTemplateBlock(content, {
      ...target,
      label: "Detailed explanation"
    })

    expect(labelOnlyEdit.blocks[1]).toMatchObject({
      fieldKey: "details",
      label: "Detailed explanation"
    })

    const conflictingKeyEdit = updateTemplateBlock(content, {
      ...target,
      fieldKey: "APPROVAL STATUS"
    })

    expect(conflictingKeyEdit.blocks[1]).toMatchObject({
      fieldKey: "approval_status_2"
    })
    expect(templateContentV3Schema.safeParse(conflictingKeyEdit).success).toBe(
      true
    )
  })
})

function createStructuredContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: SOURCE_ID,
      type: "checkbox_field",
      fieldKey: "approval_status",
      label: "Approval status",
      required: false,
      helpText: null,
      checkedByDefault: false
    },
    {
      id: TARGET_ID,
      type: "text_field",
      fieldKey: "details",
      label: "Details",
      required: false,
      helpText: null,
      placeholder: null,
      multiline: true,
      visibleWhen: {
        sourceBlockId: SOURCE_ID,
        operator: "equals",
        value: true
      }
    },
    {
      id: THIRD_FIELD_ID,
      type: "date_field",
      fieldKey: "review_date",
      label: "Review date",
      required: false,
      helpText: null
    },
    {
      id: SECOND_SECTION_BLOCK_ID,
      type: "paragraph",
      text: "Terms",
      alignment: "left"
    }
  ]
  content.sections = [
    {
      id: FIRST_SECTION_ID,
      label: "Approval details",
      startBlockId: SOURCE_ID,
      pageBreakBefore: false,
      keepTogether: true
    },
    {
      id: SECOND_SECTION_ID,
      label: "Terms",
      startBlockId: SECOND_SECTION_BLOCK_ID,
      pageBreakBefore: true,
      keepTogether: false
    }
  ]
  content.fieldGroups = [
    {
      id: GROUP_ID,
      label: "Approval fields",
      startBlockId: SOURCE_ID,
      endBlockId: THIRD_FIELD_ID,
      columns: 2,
      keepTogether: true
    }
  ]
  content.blockRules = [
    {
      blockId: TARGET_ID,
      pageBreakBefore: false,
      keepWithNext: true
    }
  ]

  return content
}
