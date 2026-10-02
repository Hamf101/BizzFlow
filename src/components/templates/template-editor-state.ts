import type { TemplateBlock, TemplateContent } from "@/types/template"
import { createUniqueTemplateFieldKey } from "@/types/template-structure"

type TemplateFieldBlockType = Extract<
  TemplateBlock,
  { fieldKey: string }
>["type"]

const DEFAULT_FIELD_LABEL_BY_TYPE: Record<TemplateFieldBlockType, string> = {
  text_field: "Text field",
  date_field: "Date field",
  checkbox_field: "Checkbox",
  dropdown_field: "Dropdown",
  choice_grid_field: "Question grid",
  table_field: "Fill-in table",
  initials_field: "Initials field",
  signature_field: "Signature field",
  file_field: "File upload"
}

const PLACEHOLDER_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export type TemplateEditorState = {
  title: string
  description: string
  category: string
  content: TemplateContent
}

/**
 * Creates a schema-shaped starter block for a user-selected block type.
 *
 * @param blockType - Canonical discriminant for the requested block.
 * @param existingBlocks - Current blocks used to keep generated field keys unique.
 * @returns A new block with a UUID and clear editable defaults.
 */
export function createTemplateBlock(
  blockType: TemplateBlock["type"],
  existingBlocks: readonly TemplateBlock[] = []
): TemplateBlock {
  const id = crypto.randomUUID()

  switch (blockType) {
    case "heading":
      return {
        id,
        type: blockType,
        text: "New heading",
        level: 2,
        alignment: "left"
      }
    case "paragraph":
      return { id, type: blockType, text: "", alignment: "left" }
    case "bullet_list":
      return { id, type: blockType, items: ["List item"] }
    case "numbered_list":
      return { id, type: blockType, items: ["List item"] }
    case "image":
      return {
        id,
        type: blockType,
        dataUrl: PLACEHOLDER_IMAGE_DATA_URL,
        altText: "Image",
        caption: null,
        alignment: "center",
        widthPercent: 100
      }
    case "table":
      return {
        id,
        type: blockType,
        headers: ["Column 1", "Column 2"],
        rows: [["", ""]]
      }
    case "divider":
      return { id, type: blockType }
    case "text_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType,
        placeholder: null,
        multiline: false
      }
    case "date_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType
      }
    case "checkbox_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType,
        checkedByDefault: false
      }
    case "dropdown_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType,
        placeholder: "Select an option",
        options: []
      }
    case "choice_grid_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType,
        rows: ["First statement", "Second statement"],
        options: ["Yes", "No", "N/A"]
      }
    case "table_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType,
        columns: [{ label: "Date", format: "date" }, { label: "Details" }],
        rows: 5
      }
    case "initials_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType
      }
    case "signature_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType
      }
    case "file_field":
      return {
        ...createFieldDefaults(id, blockType, existingBlocks),
        type: blockType
      }
  }
}

function createFieldDefaults(
  id: string,
  blockType: TemplateFieldBlockType,
  existingBlocks: readonly TemplateBlock[]
): {
  id: string
  fieldKey: string
  label: string
  required: false
  helpText: null
} {
  const label = DEFAULT_FIELD_LABEL_BY_TYPE[blockType]

  return {
    id,
    fieldKey: createUniqueTemplateFieldKey(label, existingBlocks),
    label,
    required: false,
    helpText: null
  }
}
