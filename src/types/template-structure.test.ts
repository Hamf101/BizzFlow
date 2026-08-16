import { describe, expect, it } from "vitest"

import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  evaluateTemplateBlockDeletion,
  evaluateTemplateBlockMove,
  evaluateTemplateDropdownOptionEdit,
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
const DROPDOWN_ID = "60000000-0000-4000-8000-000000000031"
const DROPDOWN_DEPENDENT_ID = "60000000-0000-4000-8000-000000000032"
const SECOND_DROPDOWN_DEPENDENT_ID =
  "60000000-0000-4000-8000-000000000033"

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

  it("identifies every conditional field before deleting its visibility source", () => {
    const result = evaluateTemplateBlockDeletion(
      createStructuredContent().blocks,
      SOURCE_ID
    )

    expect(result).toMatchObject({
      success: false,
      code: "visibility_source_in_use",
      dependentBlockIds: [TARGET_ID]
    })

    if (result.success) {
      throw new Error("Expected deletion to be refused.")
    }

    expect(result.message).toContain(
      "Change the affected field to Always visible or choose another condition first."
    )

    expect(
      evaluateTemplateBlockDeletion(
        createDropdownVisibilityContent().blocks,
        DROPDOWN_ID
      )
    ).toMatchObject({
      success: false,
      code: "visibility_source_in_use",
      dependentBlockIds: [
        DROPDOWN_DEPENDENT_ID,
        SECOND_DROPDOWN_DEPENDENT_ID
      ]
    })
  })

  it("identifies conditional fields made invalid by an adjacent move", () => {
    const blocks = createStructuredContent().blocks

    expect(evaluateTemplateBlockMove(blocks, SOURCE_ID, "down")).toMatchObject({
      success: false,
      code: "visibility_order_conflict",
      dependentBlockIds: [TARGET_ID]
    })
    expect(evaluateTemplateBlockMove(blocks, TARGET_ID, "up")).toMatchObject({
      success: false,
      code: "visibility_order_conflict",
      dependentBlockIds: [TARGET_ID]
    })
    expect(evaluateTemplateBlockMove(blocks, THIRD_FIELD_ID, "up")).toEqual({
      success: true
    })
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

  it("atomically remaps exact-value dependents when a dropdown option is renamed", () => {
    const content = createDropdownVisibilityContent()
    const dropdown = content.blocks[0]

    if (dropdown?.type !== "dropdown_field") {
      throw new Error("Expected a dropdown field fixture.")
    }

    const updated = updateTemplateBlock(content, {
      ...dropdown,
      options: ["Standard", "Custom", "Obsolete"]
    })

    expect(updated.blocks.map((block) => block.id)).toEqual(
      content.blocks.map((block) => block.id)
    )
    expect(updated.blocks[0]).toMatchObject({
      fieldKey: "request_category",
      options: ["Standard", "Custom", "Obsolete"]
    })
    expect(updated.blocks[1]).toMatchObject({
      fieldKey: "category_details",
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Custom"
      }
    })
    expect(updated.blocks[2]).toMatchObject({
      fieldKey: "category_review_date",
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Custom"
      }
    })
    expect(templateContentV3Schema.safeParse(updated).success).toBe(true)
  })

  it("refuses to delete an option while conditional fields depend on it", () => {
    const content = createDropdownVisibilityContent()
    const dropdown = content.blocks[0]

    if (dropdown?.type !== "dropdown_field") {
      throw new Error("Expected a dropdown field fixture.")
    }

    const optionEdit = evaluateTemplateDropdownOptionEdit(
      content.blocks,
      dropdown.id,
      ["Standard", "Obsolete"]
    )

    expect(optionEdit).toMatchObject({
      success: false,
      code: "dependent_option_removal",
      dependentBlockIds: [
        DROPDOWN_DEPENDENT_ID,
        SECOND_DROPDOWN_DEPENDENT_ID
      ]
    })

    if (optionEdit.success) {
      throw new Error("Expected dependent option removal to be refused.")
    }

    expect(optionEdit.message).toContain(
      "Change those fields to Always visible or choose another condition first."
    )

    const updated = updateTemplateBlock(content, {
      ...dropdown,
      options: ["Standard", "Obsolete"]
    })

    expect(updated).toBe(content)
    expect(updated.blocks[1]).toHaveProperty("visibleWhen.value", "Other")
    expect(updated.blocks[2]).toHaveProperty("visibleWhen.value", "Other")
  })

  it("allows deleting an unreferenced dropdown option", () => {
    const content = createDropdownVisibilityContent()
    const dropdown = content.blocks[0]

    if (dropdown?.type !== "dropdown_field") {
      throw new Error("Expected a dropdown field fixture.")
    }

    const updated = updateTemplateBlock(content, {
      ...dropdown,
      options: ["Standard", "Other"]
    })

    expect(updated.blocks[0]).toMatchObject({
      options: ["Standard", "Other"]
    })
    expect(updated.blocks[1]).toHaveProperty("visibleWhen.value", "Other")
    expect(updated.blocks[2]).toHaveProperty("visibleWhen.value", "Other")
    expect(templateContentV3Schema.safeParse(updated).success).toBe(true)
  })

  it.each([
    {
      name: "blank",
      options: ["Standard", "", "Other"],
      code: "blank_option"
    },
    {
      name: "duplicate",
      options: ["Standard", "standard", "Other"],
      code: "duplicate_option"
    }
  ])(
    "refuses a $name option edit without dropping dependent rules",
    ({ options, code }): void => {
      const content = createDropdownVisibilityContent()
      const dropdown = content.blocks[0]

      if (dropdown?.type !== "dropdown_field") {
        throw new Error("Expected a dropdown field fixture.")
      }

      expect(
        evaluateTemplateDropdownOptionEdit(content.blocks, dropdown.id, options)
      ).toMatchObject({ success: false, code })

      const updated = updateTemplateBlock(content, {
        ...dropdown,
        options
      })

      expect(updated).toBe(content)
      expect(updated.blocks[1]).toHaveProperty("visibleWhen.value", "Other")
      expect(updated.blocks[2]).toHaveProperty("visibleWhen.value", "Other")
    }
  )

  it("keeps an Enter-created option line local until it has a valid value", () => {
    const content = createDropdownVisibilityContent()
    const dropdown = content.blocks[0]

    if (dropdown?.type !== "dropdown_field") {
      throw new Error("Expected a dropdown field fixture.")
    }

    const draftAfterEnter = `${dropdown.options.join("\n")}\n`
    const incompleteOptions = draftAfterEnter.split("\n")

    expect(
      evaluateTemplateDropdownOptionEdit(
        content.blocks,
        dropdown.id,
        incompleteOptions
      )
    ).toMatchObject({ success: false, code: "blank_option" })
    expect(
      updateTemplateBlock(content, {
        ...dropdown,
        options: incompleteOptions
      })
    ).toBe(content)

    const completedOptions = `${draftAfterEnter}New category`.split("\n")
    const completedEdit = evaluateTemplateDropdownOptionEdit(
      content.blocks,
      dropdown.id,
      completedOptions
    )

    expect(completedEdit).toMatchObject({
      success: true,
      options: ["Standard", "Other", "Obsolete", "New category"]
    })

    const updated = updateTemplateBlock(content, {
      ...dropdown,
      options: completedOptions
    })

    expect(updated.blocks[0]).toHaveProperty("options", completedOptions)
    expect(updated.blocks[1]).toHaveProperty("visibleWhen.value", "Other")
    expect(updated.blocks[2]).toHaveProperty("visibleWhen.value", "Other")
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

function createDropdownVisibilityContent(): TemplateContentV3 {
  const content = createBlankTemplateContent()
  content.blocks = [
    {
      id: DROPDOWN_ID,
      type: "dropdown_field",
      fieldKey: "request_category",
      label: "Request category",
      required: true,
      helpText: null,
      placeholder: "Select a category",
      options: ["Standard", "Other", "Obsolete"]
    },
    {
      id: DROPDOWN_DEPENDENT_ID,
      type: "text_field",
      fieldKey: "category_details",
      label: "Category details",
      required: true,
      helpText: null,
      placeholder: null,
      multiline: false,
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Other"
      }
    },
    {
      id: SECOND_DROPDOWN_DEPENDENT_ID,
      type: "date_field",
      fieldKey: "category_review_date",
      label: "Category review date",
      required: false,
      helpText: null,
      visibleWhen: {
        sourceBlockId: DROPDOWN_ID,
        operator: "equals",
        value: "Other"
      }
    }
  ]
  content.sections = [
    {
      id: DROPDOWN_ID,
      label: "Request details",
      startBlockId: DROPDOWN_ID,
      pageBreakBefore: false,
      keepTogether: false
    }
  ]

  return content
}
