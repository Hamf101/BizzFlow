import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  templateBlockSchema,
  type TemplateBlock,
} from "@/types/template"

import {
  createTemplateBlock,
  templateEditorReducer,
  type TemplateEditorState,
} from "./template-editor-state"

const FIRST_BLOCK_ID = "00000000-0000-4000-8000-000000000001"
const SECOND_BLOCK_ID = "00000000-0000-4000-8000-000000000002"

function createState(): TemplateEditorState {
  return {
    title: "Agreement",
    description: "Reusable agreement",
    content: createBlankTemplateContent(),
  }
}

describe("templateEditorReducer", () => {
  it("adds, updates, reorders, and deletes section blocks explicitly", () => {
    const initialState = createState()
    const withHeading = templateEditorReducer(initialState, {
      type: "add_block",
      section: "body",
      block: {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "First heading",
        level: 2,
        alignment: "left",
      },
    })
    const withParagraph = templateEditorReducer(withHeading, {
      type: "add_block",
      section: "body",
      block: {
        id: SECOND_BLOCK_ID,
        type: "paragraph",
        text: "Paragraph",
        alignment: "left",
      },
    })
    const reordered = templateEditorReducer(withParagraph, {
      type: "move_block",
      section: "body",
      blockId: SECOND_BLOCK_ID,
      direction: "up",
    })
    const updated = templateEditorReducer(reordered, {
      type: "update_block",
      section: "body",
      block: {
        id: FIRST_BLOCK_ID,
        type: "heading",
        text: "Updated heading",
        level: 1,
        alignment: "center",
      },
    })
    const deleted = templateEditorReducer(updated, {
      type: "delete_block",
      section: "body",
      blockId: SECOND_BLOCK_ID,
    })

    expect(initialState.content.sections.body.blocks).toEqual([])
    expect(reordered.content.sections.body.blocks.map((block) => block.id)).toEqual([
      SECOND_BLOCK_ID,
      FIRST_BLOCK_ID,
    ])
    expect(updated.content.sections.body.blocks[1]).toMatchObject({
      text: "Updated heading",
      level: 1,
    })
    expect(deleted.content.sections.body.blocks).toHaveLength(1)
    expect(deleted.content.sections.body.blocks[0]?.id).toBe(FIRST_BLOCK_ID)
  })

  it("keeps header and footer repetition independent", () => {
    const headerRepeating = templateEditorReducer(createState(), {
      type: "set_repeat",
      section: "header",
      value: true,
    })

    expect(headerRepeating.content.repeat).toEqual({
      header: true,
      footer: false,
    })
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
      "file_field",
    ]

    for (const blockType of blockTypes) {
      expect(templateBlockSchema.safeParse(createTemplateBlock(blockType)).success).toBe(
        true
      )
    }
  })
})
