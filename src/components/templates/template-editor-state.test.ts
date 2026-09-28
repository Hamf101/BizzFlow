import { describe, expect, it } from "vitest"

import {
  createBlankTemplateContent,
  templateBlockSchema,
  type TemplateBlock
} from "@/types/template"
import { insertTemplateBlock, updateTemplateBlock } from "@/types/template-structure"

import { createTemplateBlock } from "./template-editor-state"

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

describe("createTemplateBlock", () => {
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

    const added = insertTemplateBlock(createBlankTemplateContent(), null, block)
    const updated = updateTemplateBlock(added, {
      ...block,
      label: "Authorized signer"
    })

    expect(updated.blocks[0]).toMatchObject({
      label: "Authorized signer",
      fieldKey: "signature_field"
    })
  })
})
