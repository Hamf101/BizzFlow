import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  parseTemplateContent,
  templateBlockSchema,
  type TemplateBlock
} from "@/types/template"

import {
  createTemplateBlock,
  templateEditorReducer,
  type TemplateEditorState
} from "./template-editor-state"

const FIRST_BLOCK_ID = "00000000-0000-4000-8000-000000000001"
const SECOND_BLOCK_ID = "00000000-0000-4000-8000-000000000002"

const FIELD_DEFAULTS = [
  ["text_field", "Text field", "text_field"],
  ["date_field", "Date field", "date_field"],
  ["checkbox_field", "Checkbox", "checkbox"],
  ["dropdown_field", "Dropdown", "dropdown"],
  ["initials_field", "Initials field", "initials_field"],
  ["signature_field", "Signature field", "signature_field"],
  ["file_field", "File upload", "file_upload"]
] as const satisfies ReadonlyArray<
  readonly [TemplateBlock["type"], string, string]
>

function createState(): TemplateEditorState {
  return {
    title: "Agreement",
    description: "Reusable agreement",
    content: createBlankTemplateContent()
  }
}

describe("templateEditorReducer", () => {
  it("upgrades version-two content only when it first enters an edit action", () => {
    const legacyContent = parseTemplateContent({
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
          text: "Legacy draft",
          alignment: "left"
        }
      ]
    })
    const initialState: TemplateEditorState = {
      title: "Legacy draft",
      description: "",
      content: legacyContent
    }

    expect(initialState.content.schemaVersion).toBe(2)

    const edited = templateEditorReducer(initialState, {
      type: "set_title",
      value: "Edited draft"
    })

    expect(edited.content).toMatchObject({
      schemaVersion: 3,
      sections: [
        {
          id: FIRST_BLOCK_ID,
          label: "Section 1",
          startBlockId: FIRST_BLOCK_ID
        }
      ]
    })
  })

  it("adds, updates, reorders, and deletes free-form blocks explicitly", () => {
    const initialState = createState()
    const withHeading = templateEditorReducer(initialState, {
      type: "add_block",
      block: {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "First heading",
        level: 2,
        alignment: "left"
      }
    })
    const withParagraph = templateEditorReducer(withHeading, {
      type: "add_block",
      block: {
        id: SECOND_BLOCK_ID,
        type: "paragraph",
        text: "Paragraph",
        alignment: "left"
      }
    })
    const reordered = templateEditorReducer(withParagraph, {
      type: "move_block",
      blockId: SECOND_BLOCK_ID,
      direction: "up"
    })
    const updated = templateEditorReducer(reordered, {
      type: "update_block",
      block: {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "Updated heading",
        level: 1,
        alignment: "center"
      }
    })
    const deleted = templateEditorReducer(updated, {
      type: "delete_block",
      blockId: SECOND_BLOCK_ID
    })

    expect(initialState.content.blocks).toEqual([])
    expect(reordered.content.blocks.map((block) => block.id)).toEqual([
      SECOND_BLOCK_ID,
      FIRST_BLOCK_ID
    ])
    expect(updated.content.blocks[1]).toMatchObject({
      text: "Updated heading",
      level: 1
    })
    expect(deleted.content.blocks).toHaveLength(1)
    expect(deleted.content.blocks[0]?.id).toBe(FIRST_BLOCK_ID)
    expect(deleted.content).toMatchObject({
      schemaVersion: 3,
      sections: [{ id: FIRST_BLOCK_ID, startBlockId: FIRST_BLOCK_ID }]
    })
  })

  it("inserts a block at a requested editorial gutter position", () => {
    const withFirstBlock = templateEditorReducer(createState(), {
      type: "add_block",
      block: {
        id: FIRST_BLOCK_ID,
        type: "paragraph",
        text: "First",
        alignment: "left"
      }
    })
    const inserted = templateEditorReducer(withFirstBlock, {
      type: "insert_block",
      afterBlockId: FIRST_BLOCK_ID,
      block: {
        id: SECOND_BLOCK_ID,
        type: "heading",
        text: "Next",
        level: 2,
        alignment: "left"
      }
    })

    expect(inserted.content.blocks.map((block) => block.id)).toEqual([
      FIRST_BLOCK_ID,
      SECOND_BLOCK_ID
    ])
  })

  it("replaces the draft with a validated Flow result", () => {
    const nextState = {
      ...createState(),
      title: "AI organized agreement"
    }

    expect(
      templateEditorReducer(createState(), {
        type: "replace_state",
        value: nextState
      })
    ).toBe(nextState)
  })

  it("creates a schema-valid starter for every supported block type", () => {
    const blockTypes: TemplateBlock["type"][] = [
      "heading",
      "paragraph",
      "bullet_list",
      "numbered_list",
      "image",
      "table",
      "divider",
      "text_field",
      "date_field",
      "checkbox_field",
      "dropdown_field",
      "initials_field",
      "signature_field",
      "file_field"
    ]

    for (const blockType of blockTypes) {
      expect(
        templateBlockSchema.safeParse(createTemplateBlock(blockType)).success
      ).toBe(true)
    }
  })

  it.each(FIELD_DEFAULTS)(
    "creates %s with a meaningful label and deterministic field key",
    (blockType, expectedLabel, expectedFieldKey) => {
      const block = createTemplateBlock(blockType)

      expect(block).toMatchObject({
        label: expectedLabel,
        fieldKey: expectedFieldKey
      })
    }
  )

  it("creates dropdowns without fake seeded choices", () => {
    expect(createTemplateBlock("dropdown_field")).toMatchObject({
      label: "Dropdown",
      fieldKey: "dropdown",
      options: []
    })
  })

  it("deduplicates generated field keys against current blocks", () => {
    const textField = createTemplateBlock("text_field")
    const dateField = createTemplateBlock("date_field")

    if (textField.type !== "text_field" || dateField.type !== "date_field") {
      throw new Error("Expected field block factories to preserve their types.")
    }

    const existingBlocks: TemplateBlock[] = [
      textField,
      {
        ...dateField,
        fieldKey: "TEXT_FIELD_2"
      }
    ]

    expect(
      createTemplateBlock("text_field", existingBlocks)
    ).toMatchObject({
      label: "Text field",
      fieldKey: "text_field_3"
    })
  })

  it("keeps the generated field key stable when its label changes", () => {
    const block = createTemplateBlock("signature_field")

    if (block.type !== "signature_field") {
      throw new Error("Expected a signature field block.")
    }

    const renamed = templateEditorReducer(createState(), {
      type: "add_block",
      block
    })
    const updated = templateEditorReducer(renamed, {
      type: "update_block",
      block: {
        ...block,
        label: "Authorized signer"
      }
    })

    expect(updated.content.blocks[0]).toMatchObject({
      label: "Authorized signer",
      fieldKey: "signature_field"
    })
  })
})
