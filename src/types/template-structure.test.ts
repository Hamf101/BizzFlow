import { describe, expect, it } from "vitest"

import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  duplicateTemplateBlock,
  evaluateTemplateBlockDeletion,
  evaluateTemplateDropdownOptionEdit,
  getTemplateSectionForBlock,
  insertTemplateBlock,
  listTemplateBlockSlots,
  moveTemplateBlockTo,
  moveTemplateSection,
  removeTemplateSection,
  frameOf,
  setBlockKeepWithNext,
  setBlockRule,
  placeBeside,
  setRowWidths,
  standAlone,
  startTemplateSection,
  stepTemplateBlockSlot,
  updateTemplateBlock,
  updateTemplateFieldGroup,
  updateTemplateSection,
  withGeneratedFieldKeys,
  type TemplateMoveResult
} from "./template-structure"
import {
  MAX_TEMPLATE_BLOCK_COUNT,
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
const EXTRA_ID = "60000000-0000-4000-8000-000000000006"

function placed(result: TemplateMoveResult): TemplateContentV3 {
  if (!result.success) {
    throw new Error(result.message)
  }

  return result.content
}

describe("duplicateTemplateBlock", () => {
  it("copies a conditional field after its source without retargeting its condition", () => {
    const content = createStructuredContent()
    const copy = duplicateTemplateBlock(content, TARGET_ID, INSERTED_ID)
    expect(copy.blocks.map((block) => block.id)).toEqual([
      SOURCE_ID, TARGET_ID, INSERTED_ID, THIRD_FIELD_ID, SECOND_SECTION_BLOCK_ID,
    ])
    expect(copy.blocks[2]).toMatchObject({
      fieldKey: "details_2",
      visibleWhen: { sourceBlockId: SOURCE_ID, operator: "equals", value: true },
    })
    expect(copy.blockRules).toContainEqual({
      blockId: INSERTED_ID, pageBreakBefore: false, keepWithNext: true,
    })
    expect(copy.sections).toEqual(content.sections)
    expect(templateContentV3Schema.safeParse(copy).success).toBe(true)
    expect(content.blocks).toHaveLength(4)
  })

  it("sets a copy of a placed picture a little down and across, still on its page", () => {
    const picture = {
      alignment: "center" as const,
      altText: "Seal",
      caption: null,
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      id: SOURCE_ID,
      placement: { height: 20, page: 2, width: 20, x: 79, y: 10 },
      type: "image" as const,
      widthPercent: 100,
    }
    const copy = duplicateTemplateBlock({ ...createBlankTemplateContent(), blocks: [picture] }, SOURCE_ID, INSERTED_ID)

    expect(copy.blocks.map((block) => (block.type === "image" ? block.placement : null))).toEqual([
      { height: 20, page: 2, width: 20, x: 79, y: 10 },
      { height: 20, page: 2, width: 20, x: 80, y: 13 },
    ])
  })

  it("retains group membership when copying its last field", () => {
    const copy = duplicateTemplateBlock(createStructuredContent(), THIRD_FIELD_ID, INSERTED_ID)
    expect(copy.fieldGroups[0].endBlockId).toBe(INSERTED_ID)
    expect(templateContentV3Schema.safeParse(copy).success).toBe(true)
  })

  it("preserves dropdown options and leaves existing dependents on the original", () => {
    const content = createDropdownVisibilityContent()
    const copy = duplicateTemplateBlock(content, DROPDOWN_ID, INSERTED_ID)
    expect(copy.blocks[1]).toMatchObject({ fieldKey: "request_category_2" })
    expect(copy.blocks.find((block) => block.id === DROPDOWN_DEPENDENT_ID))
      .toEqual(content.blocks.find((block) => block.id === DROPDOWN_DEPENDENT_ID))
    const duplicated = copy.blocks[1]
    const original = content.blocks[0]
    if (duplicated.type !== "dropdown_field" || original.type !== "dropdown_field") {
      throw new Error("Expected dropdown fixtures")
    }
    expect(duplicated.options).toEqual(original.options)
    duplicated.options.push("New option")
    expect(original.options).not.toContain("New option")
  })

  it("deep copies table cells and keeps repeated copies uniquely keyed", () => {
    const content = createStructuredContent()
    content.blocks.push({ id: DROPDOWN_ID, type: "table", headers: ["Item"], rows: [["Original"]] })
    const copied = duplicateTemplateBlock(content, DROPDOWN_ID, INSERTED_ID)
    const table = copied.blocks.at(-1)!
    if (table.type !== "table") throw new Error("Expected copied table")
    table.rows[0][0] = "Edited copy"
    expect(content.blocks.at(-1)).toMatchObject({ rows: [["Original"]] })

    const first = duplicateTemplateBlock(createStructuredContent(), TARGET_ID, INSERTED_ID)
    const second = duplicateTemplateBlock(first, TARGET_ID, DROPDOWN_ID)
    expect(second.blocks[2]).toMatchObject({ fieldKey: "details_3" })
  })

  it("does not insert missing sources, duplicate ids, or blocks past the size limit", () => {
    const content = createStructuredContent()
    expect(duplicateTemplateBlock(content, INSERTED_ID, DROPDOWN_ID)).toBe(content)
    expect(duplicateTemplateBlock(content, TARGET_ID, SOURCE_ID)).toBe(content)
    content.blocks = Array.from({ length: MAX_TEMPLATE_BLOCK_COUNT }, (_, index) => ({
      id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      type: "paragraph", text: "Text", alignment: "left",
    }))
    expect(duplicateTemplateBlock(content, content.blocks[0].id, "60000000-0000-4000-8000-000000000999"))
      .toBe(content)
  })
})
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

  it("keeps a row whole when any block is inserted inside it, retaining unaffected references", () => {
    const content = createStructuredContent()
    const inserted = insertTemplateBlock(
      content,
      SOURCE_ID,
      {
        id: INSERTED_ID,
        type: "divider"
      }
    )

    // Rows hold any block now, so a divider inside one joins it instead of breaking it.
    expect(inserted.fieldGroups).toEqual(content.fieldGroups)
    expect(inserted.blockRules).toEqual([
      {
        blockId: TARGET_ID,
        pageBreakBefore: false,
        keepWithNext: true
      }
    ])
    expect(templateContentV3Schema.safeParse(inserted).success).toBe(true)
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

describe("authoring sections, side-by-side fields and keep with next", () => {
  it("keeps a section that starts partway down where it is as blocks come and go above it", () => {
    const content = createStructuredContent()
    content.sections = content.sections.slice(1)

    const inserted = insertTemplateBlock(content, null, { id: INSERTED_ID, type: "paragraph", text: "Welcome", alignment: "left" })
    const deleted = deleteTemplateBlock(content, SOURCE_ID)

    expect(inserted.sections.map((section) => section.startBlockId)).toEqual([SECOND_SECTION_BLOCK_ID])
    expect(deleted.sections.map((section) => section.startBlockId)).toEqual([SECOND_SECTION_BLOCK_ID])
    expect(deleted.fieldGroups.map((group) => [group.startBlockId, group.endBlockId])).toEqual([[TARGET_ID, THIRD_FIELD_ID]])
    expect(templateContentV3Schema.safeParse(inserted).success).toBe(true)
    expect(templateContentV3Schema.safeParse(deleted).success).toBe(true)
  })

  it("starts, titles, rules and removes a section without touching the words", () => {
    const content = { ...createStructuredContent(), sections: [] }
    const started = startTemplateSection(content, SECOND_SECTION_BLOCK_ID, SECOND_SECTION_ID)
    const titled = updateTemplateSection(started, SECOND_SECTION_ID, { label: "Terms", pageBreakBefore: true, keepTogether: true })

    expect(started.sections).toEqual([
      { id: SECOND_SECTION_ID, label: "Section title", startBlockId: SECOND_SECTION_BLOCK_ID, pageBreakBefore: false, keepTogether: false },
    ])
    expect(titled.sections).toEqual([
      { id: SECOND_SECTION_ID, label: "Terms", startBlockId: SECOND_SECTION_BLOCK_ID, pageBreakBefore: true, keepTogether: true },
    ])
    expect(templateContentV3Schema.safeParse(started).success).toBe(true)
    expect(templateContentV3Schema.safeParse(titled).success).toBe(true)
    expect(startTemplateSection(titled, SECOND_SECTION_BLOCK_ID, FIRST_SECTION_ID)).toBe(titled)
    expect(removeTemplateSection(titled, SECOND_SECTION_ID)).toEqual({ ...titled, sections: [] })
  })

  it("starts a section before a row of side-by-side fields instead of splitting the row", () => {
    const content = { ...createStructuredContent(), sections: [] }
    const started = startTemplateSection(content, THIRD_FIELD_ID, FIRST_SECTION_ID, "Approval")

    expect(started.sections.map((section) => [section.label, section.startBlockId])).toEqual([["Approval", SOURCE_ID]])
    expect(started.fieldGroups).toEqual(content.fieldGroups)
  })

  it("puts any block beside another, widens the row, and lets a block stand alone again", () => {
    const content = { ...createStructuredContent(), sections: [], fieldGroups: [] }
    const paired = placed(placeBeside(content, SECOND_SECTION_BLOCK_ID, THIRD_FIELD_ID, "right", () => GROUP_ID))
    const widened = placed(placeBeside(paired, TARGET_ID, THIRD_FIELD_ID, "left", () => INSERTED_ID))
    const parted = placed(standAlone(widened, THIRD_FIELD_ID, () => INSERTED_ID))

    // A paragraph shares a row with a field: rows are no longer fields only.
    expect(paired.fieldGroups).toEqual([
      { id: GROUP_ID, label: null, startBlockId: THIRD_FIELD_ID, endBlockId: SECOND_SECTION_BLOCK_ID, columns: 2, keepTogether: false },
    ])
    expect(widened.fieldGroups).toEqual([{ ...paired.fieldGroups[0], startBlockId: TARGET_ID, columns: 3 }])
    expect(parted.blocks.map((block) => block.id)).toEqual([SOURCE_ID, TARGET_ID, SECOND_SECTION_BLOCK_ID, THIRD_FIELD_ID])
    expect(parted.fieldGroups).toEqual([{ ...paired.fieldGroups[0], startBlockId: TARGET_ID, endBlockId: SECOND_SECTION_BLOCK_ID }])

    for (const step of [paired, widened, parted]) {
      expect(templateContentV3Schema.safeParse(step).success).toBe(true)
    }
  })

  it("joins a row inside the section of the block it goes beside, and holds at most four", () => {
    const content = { ...createStructuredContent(), fieldGroups: [] }
    const joined = placed(placeBeside(content, THIRD_FIELD_ID, SECOND_SECTION_BLOCK_ID, "left", () => GROUP_ID))

    // The date leaves the first section to open the second, beside its first block.
    expect(joined.sections.map((section) => section.startBlockId)).toEqual([SOURCE_ID, THIRD_FIELD_ID])
    expect(joined.fieldGroups[0]).toMatchObject({ startBlockId: THIRD_FIELD_ID, endBlockId: SECOND_SECTION_BLOCK_ID })
    expect(templateContentV3Schema.safeParse(joined).success).toBe(true)

    const four = { ...content, sections: [], fieldGroups: [{ id: GROUP_ID, label: null, startBlockId: TARGET_ID, endBlockId: EXTRA_ID, columns: 4, keepTogether: false }] }
    four.blocks = [...content.blocks, { alignment: "left" as const, id: EXTRA_ID, text: "More", type: "paragraph" as const }]

    expect(placeBeside(four, SOURCE_ID, TARGET_ID, "left", () => INSERTED_ID)).toMatchObject({ code: "row_full", success: false })
  })

  it("sizes a row's columns in twelfths, and keeps equal columns without widths", () => {
    const content = createStructuredContent()
    const row = { ...content, fieldGroups: [{ ...content.fieldGroups[0], endBlockId: TARGET_ID }] }

    expect(setRowWidths(row, GROUP_ID, [4, 8]).fieldGroups[0]).toMatchObject({ widths: [4, 8] })
    expect(setRowWidths(setRowWidths(row, GROUP_ID, [4, 8]), GROUP_ID, [6, 6]).fieldGroups[0]).not.toHaveProperty("widths")
    // Widths that do not fill the row, or leave a column too thin to use, change nothing.
    expect(setRowWidths(row, GROUP_ID, [5, 5])).toBe(row)
    expect(setRowWidths(row, GROUP_ID, [1, 11])).toBe(row)
    expect(templateContentV3Schema.safeParse(setRowWidths(row, GROUP_ID, [4, 8])).success).toBe(true)
  })

  it("labels a group of fields, takes an emptied label away, and keeps the group on one page", () => {
    const content = createStructuredContent()
    const relabelled = updateTemplateFieldGroup(content, GROUP_ID, { label: "Signed by" })
    const unlabelled = updateTemplateFieldGroup(relabelled, GROUP_ID, { keepTogether: false, label: "" })

    expect(relabelled.fieldGroups[0]).toMatchObject({ keepTogether: true, label: "Signed by" })
    expect(unlabelled.fieldGroups[0]).toMatchObject({ keepTogether: false, label: null })
    expect(templateContentV3Schema.safeParse(unlabelled).success).toBe(true)
  })

  it("keeps a block with the next one alongside a page break it already starts", () => {
    const content = createStructuredContent()
    const broken = { ...content, blockRules: [{ blockId: THIRD_FIELD_ID, pageBreakBefore: true, keepWithNext: false }] }
    const kept = setBlockKeepWithNext(broken, THIRD_FIELD_ID, true)

    expect(kept.blockRules).toEqual([{ blockId: THIRD_FIELD_ID, pageBreakBefore: true, keepWithNext: true }])
    expect(setBlockKeepWithNext(kept, THIRD_FIELD_ID, false).blockRules).toEqual(broken.blockRules)
    expect(setBlockKeepWithNext(content, SOURCE_ID, true).blockRules).toEqual([
      ...content.blockRules,
      { blockId: SOURCE_ID, pageBreakBefore: false, keepWithNext: true },
    ])
    expect(setBlockKeepWithNext(content, TARGET_ID, false).blockRules).toEqual([])
  })

  it("keeps where a block was put across and down the page through moves, until it is put back", () => {
    const content = createStructuredContent()
    const put = setBlockRule(content, SECOND_SECTION_BLOCK_ID, { frame: { left: 50, width: 50 }, spaceAbove: 24 })
    const moved = placed(moveTemplateBlockTo(put, SECOND_SECTION_BLOCK_ID, { inGroup: false, index: 0, opens: null }, INSERTED_ID))
    const kept = setBlockKeepWithNext(moved, SECOND_SECTION_BLOCK_ID, true)
    const rule = { blockId: SECOND_SECTION_BLOCK_ID, frame: { left: 50, width: 50 }, keepWithNext: false, pageBreakBefore: false, spaceAbove: 24 }

    const own = (moving: TemplateContentV3) => moving.blockRules.filter((candidate) => candidate.blockId === SECOND_SECTION_BLOCK_ID)

    expect(own(moved)).toEqual([rule])
    expect(templateContentV3Schema.safeParse(moved).success).toBe(true)
    expect(own(kept)).toEqual([{ ...rule, keepWithNext: true }])
    // Back across the whole page with no space, and not kept with the next, it has no rule.
    expect(own(setBlockRule(kept, SECOND_SECTION_BLOCK_ID, { frame: undefined, keepWithNext: false, spaceAbove: 0 }))).toEqual([])
    expect(frameOf(0.2, 99.9)).toBeUndefined()
    expect(frameOf(33.333, 80)).toEqual({ left: 33.3, width: 66.7 })
  })

  it("keeps a place pushed past the page's edges, or a space held down too long, one the template can still be saved with", () => {
    const content = createStructuredContent()
    const pushed = [
      setBlockRule(content, SECOND_SECTION_BLOCK_ID, { spaceAbove: 900 }),
      setBlockRule(content, SECOND_SECTION_BLOCK_ID, { frame: frameOf(-3.2, 40) }),
      setBlockRule(content, SECOND_SECTION_BLOCK_ID, { frame: frameOf(98, 2) }),
    ]

    for (const saved of pushed) {
      expect(templateContentV3Schema.safeParse(saved).success).toBe(true)
    }
    expect(pushed[0]!.blockRules.find((rule) => rule.blockId === SECOND_SECTION_BLOCK_ID)?.spaceAbove).toBe(600)
  })
})

describe("generated field keys", () => {
  it("rebuilds keys typed by hand or repeated, and leaves good ones alone", () => {
    const keyed = (id: string, fieldKey: string) => ({
      fieldKey,
      helpText: null,
      id,
      label: "Label",
      multiline: false,
      placeholder: null,
      required: false,
      type: "text_field" as const
    })
    const content = createBlankTemplateContent()
    content.blocks = [keyed(SOURCE_ID, "Client-Name"), keyed(TARGET_ID, "email"), keyed(THIRD_FIELD_ID, "email")]

    expect(
      withGeneratedFieldKeys(content).blocks.map((block) => ("fieldKey" in block ? block.fieldKey : null))
    ).toEqual(["client_name", "email", "email_2"])

    const good = { ...content, blocks: [keyed(SOURCE_ID, "client_name")] }
    expect(withGeneratedFieldKeys(good)).toBe(good)
  })
})

describe("moving blocks and sections", () => {
  const [INTRO, NAME, COMPANY, ACCOUNT, TERMS, NUMBER, THANKS] = [1, 2, 3, 4, 5, 6, 7].map(
    (index) => `61000000-0000-4000-8000-00000000000${index}`
  ) as [string, string, string, string, string, string, string]
  const CUSTOMER = "61000000-0000-4000-8000-000000000011"
  const TERMS_SECTION = "61000000-0000-4000-8000-000000000012"
  const ROW = "61000000-0000-4000-8000-000000000021"
  const FILLER = "61000000-0000-4000-8000-000000000031"
  const text = (id: string, label: string, visibleWhen?: { sourceBlockId: string; operator: "equals"; value: boolean }) => ({
    fieldKey: label.toLowerCase().replace(/ /g, "_"), helpText: null, id, label, multiline: false, placeholder: null, required: false, type: "text_field" as const,
    ...(visibleWhen ? { visibleWhen } : {}),
  })

  // Welcome, then Customer: Name and Company side by side, and a checkbox;
  // then Terms: a line, a number asked only with an account, and thanks.
  function agreement(): TemplateContentV3 {
    return {
      ...createBlankTemplateContent(),
      blocks: [
        { alignment: "left", id: INTRO, text: "Welcome", type: "paragraph" },
        text(NAME, "Name"),
        text(COMPANY, "Company"),
        { checkedByDefault: false, fieldKey: "has_account", helpText: null, id: ACCOUNT, label: "Has an account", required: false, type: "checkbox_field" },
        { alignment: "left", id: TERMS, text: "Pay monthly.", type: "paragraph" },
        text(NUMBER, "Account number", { operator: "equals", sourceBlockId: ACCOUNT, value: true }),
        { alignment: "left", id: THANKS, text: "Thanks.", type: "paragraph" },
      ],
      sections: [
        { id: CUSTOMER, keepTogether: false, label: "Customer", pageBreakBefore: false, startBlockId: NAME },
        { id: TERMS_SECTION, keepTogether: false, label: "Terms", pageBreakBefore: true, startBlockId: TERMS },
      ],
      fieldGroups: [{ columns: 2, endBlockId: COMPANY, id: ROW, keepTogether: false, label: null, startBlockId: NAME }],
      blockRules: [{ blockId: ACCOUNT, keepWithNext: true, pageBreakBefore: false }],
    }
  }
  const step = (content: TemplateContentV3, blockId: string, direction: "up" | "down"): TemplateContentV3 => {
    const slot = stepTemplateBlockSlot(content, blockId, direction)
    const moved = slot ? moveTemplateBlockTo(content, blockId, slot, FILLER) : null

    if (!moved?.success) {
      throw new Error(`Could not move ${blockId} ${direction}.`)
    }

    expect(templateContentV3Schema.safeParse(moved.content).success).toBe(true)
    return moved.content
  }
  const order = (content: TemplateContentV3) => content.blocks.map((block) => block.id)
  const starts = (content: TemplateContentV3) => content.sections.map((section) => [section.id, section.startBlockId])

  it("steps a block past a row as one piece and a section's title as one step, moving nothing else", () => {
    const content = agreement()
    const up = step(content, ACCOUNT, "up")
    const upAgain = step(up, ACCOUNT, "up")
    const down = step(content, ACCOUNT, "down")

    // Above the row, under the Customer title; then above that title.
    expect(order(up)).toEqual([INTRO, ACCOUNT, NAME, COMPANY, TERMS, NUMBER, THANKS])
    expect(starts(up)).toEqual([[CUSTOMER, ACCOUNT], [TERMS_SECTION, TERMS]])
    expect(order(upAgain)).toEqual(order(up))
    expect(starts(upAgain)).toEqual([[CUSTOMER, NAME], [TERMS_SECTION, TERMS]])
    // Under the Terms title, which keeps its page break; the row never changes.
    expect(order(down)).toEqual([INTRO, NAME, COMPANY, ACCOUNT, TERMS, NUMBER, THANKS])
    expect(starts(down)).toEqual([[CUSTOMER, NAME], [TERMS_SECTION, ACCOUNT]])
    expect(down.sections[1]?.pageBreakBefore).toBe(true)

    for (const moved of [up, upAgain, down]) {
      expect(moved.fieldGroups).toEqual(content.fieldGroups)
      // The same block, key, condition and rules: nothing is recreated.
      expect(moved.blocks.find((block) => block.id === ACCOUNT)).toBe(content.blocks[3])
      expect(moved.blockRules).toEqual(content.blockRules)
    }
  })

  it("moves a field across its own row before taking it out of the row", () => {
    const content = agreement()
    const left = step(content, COMPANY, "up")
    const above = step(left, COMPANY, "up")
    const below = step(content, COMPANY, "down")

    expect(order(left)).toEqual([INTRO, COMPANY, NAME, ACCOUNT, TERMS, NUMBER, THANKS])
    expect(left.fieldGroups).toEqual([{ ...content.fieldGroups[0], endBlockId: NAME, startBlockId: COMPANY }])
    expect(starts(left)[0]).toEqual([CUSTOMER, COMPANY])
    // Out of the row, one field has nothing to sit beside, so the row goes.
    expect(above.fieldGroups).toEqual([])
    expect(order(above)).toEqual(order(left))
    expect(order(below)).toEqual([INTRO, NAME, COMPANY, ACCOUNT, TERMS, NUMBER, THANKS])
    expect(below.fieldGroups).toEqual([])
    // A drag drops beside a row, never inside one.
    expect(listTemplateBlockSlots(content, COMPANY, false).some((slot) => slot.inGroup)).toBe(false)
  })

  it("leaves the title of a section it empties, over an empty line", () => {
    const content: TemplateContentV3 = {
      ...agreement(),
      blocks: agreement().blocks.filter((block) => block.id !== NUMBER && block.id !== THANKS),
    }
    const slot = listTemplateBlockSlots(content, TERMS, false).find((candidate) => candidate.index === 0 && candidate.opens === null)
    const moved = slot ? moveTemplateBlockTo(content, TERMS, slot, FILLER) : null

    expect(moved?.success).toBe(true)

    if (moved?.success) {
      expect(order(moved.content)).toEqual([TERMS, INTRO, NAME, COMPANY, ACCOUNT, FILLER])
      expect(starts(moved.content)).toEqual([[CUSTOMER, NAME], [TERMS_SECTION, FILLER]])
      expect(templateContentV3Schema.safeParse(moved.content).success).toBe(true)
    }
  })

  it("refuses to put a conditional field above the field it depends on", () => {
    const content = agreement()
    const refusal = (from: TemplateContentV3, blockId: string, direction: "up" | "down") =>
      moveTemplateBlockTo(from, blockId, stepTemplateBlockSlot(from, blockId, direction)!, FILLER)
    const twiceUp = step(step(content, NUMBER, "up"), NUMBER, "up")
    const twiceDown = step(step(content, ACCOUNT, "down"), ACCOUNT, "down")

    // Each may come right up to the other, and no further.
    expect(order(twiceUp)).toEqual([INTRO, NAME, COMPANY, ACCOUNT, NUMBER, TERMS, THANKS])
    expect(order(twiceDown)).toEqual([INTRO, NAME, COMPANY, TERMS, ACCOUNT, NUMBER, THANKS])
    expect(refusal(twiceUp, NUMBER, "up")).toMatchObject({ code: "visibility_order_conflict", dependentBlockIds: [NUMBER], success: false })
    expect(refusal(twiceDown, ACCOUNT, "down")).toMatchObject({ code: "visibility_order_conflict", dependentBlockIds: [NUMBER], success: false })
  })

  it("moves a section with all it holds past its neighbour, but never past writing outside any section", () => {
    const content = { ...agreement(), blocks: agreement().blocks.map((block) => (block.id === NUMBER ? text(NUMBER, "Account number") : block)) }
    const moved = moveTemplateSection(content, TERMS_SECTION, "up")

    expect(moved.success && order(moved.content)).toEqual([INTRO, TERMS, NUMBER, THANKS, NAME, COMPANY, ACCOUNT])
    expect(moved.success && moved.content.sections.map((section) => section.id)).toEqual([TERMS_SECTION, CUSTOMER])
    expect(moved.success && templateContentV3Schema.safeParse(moved.content).success).toBe(true)
    expect(moveTemplateSection(content, CUSTOMER, "up")).toEqual({ content, success: true })
    // With its account number still asked only after the checkbox, Terms stays below it.
    expect(moveTemplateSection(agreement(), TERMS_SECTION, "up")).toMatchObject({ dependentBlockIds: [NUMBER], success: false })
  })
})
