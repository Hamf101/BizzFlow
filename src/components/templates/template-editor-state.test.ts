import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
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

function createState(): TemplateEditorState {
  return {
    title: "Agreement",
    description: "Reusable agreement",
    content: createBlankTemplateContent()
  }
}

describe("templateEditorReducer", () => {
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
})
