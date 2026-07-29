import {
  upgradeV2TemplateContentToV3,
  type TemplateBlock,
  type TemplateBranding,
  type TemplateContent,
  type TemplateContentV3
} from "@/types/template"
import {
  createUniqueTemplateFieldKey,
  deleteTemplateBlock,
  insertTemplateBlock,
  moveTemplateBlock,
  updateTemplateBlock
} from "@/types/template-structure"

type TemplateFieldBlockType = Extract<
  TemplateBlock,
  { fieldKey: string }
>["type"]

const DEFAULT_FIELD_LABEL_BY_TYPE: Record<TemplateFieldBlockType, string> = {
  text_field: "Text field",
  date_field: "Date field",
  checkbox_field: "Checkbox",
  dropdown_field: "Dropdown",
  initials_field: "Initials field",
  signature_field: "Signature field",
  file_field: "File upload"
}

const PLACEHOLDER_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export type TemplateEditorState = {
  title: string
  description: string
  content: TemplateContent
}

type EditableTemplateEditorState = Omit<TemplateEditorState, "content"> & {
  content: TemplateContentV3
}

export type TemplateEditorAction =
  | { type: "replace_state"; value: TemplateEditorState }
  | { type: "set_title"; value: string }
  | { type: "set_description"; value: string }
  | { type: "set_branding"; value: TemplateBranding }
  | { type: "add_block"; block: TemplateBlock }
  | {
      type: "insert_block"
      afterBlockId: string | null
      block: TemplateBlock
    }
  | {
      type: "update_block"
      block: TemplateBlock
    }
  | {
      type: "delete_block"
      blockId: string
    }
  | {
      type: "move_block"
      blockId: string
      direction: "up" | "down"
    }

/**
 * Applies one explicit template editor action without mutating prior state.
 *
 * @param state - Current guided editor state.
 * @param action - Typed content, metadata, or ordering action.
 * @returns A new editor state reflecting the action.
 */
export function templateEditorReducer(
  state: TemplateEditorState,
  action: TemplateEditorAction
): TemplateEditorState {
  if (action.type === "replace_state") {
    return toEditableTemplateEditorState(action.value)
  }

  const editableState = toEditableTemplateEditorState(state)

  switch (action.type) {
    case "set_title":
      return { ...editableState, title: action.value }
    case "set_description":
      return { ...editableState, description: action.value }
    case "set_branding":
      return {
        ...editableState,
        content: { ...editableState.content, branding: action.value }
      }
    case "add_block":
      return {
        ...editableState,
        content: insertTemplateBlock(
          editableState.content,
          editableState.content.blocks.at(-1)?.id ?? null,
          action.block
        )
      }
    case "insert_block":
      return {
        ...editableState,
        content: insertTemplateBlock(
          editableState.content,
          action.afterBlockId,
          action.block
        )
      }
    case "update_block":
      return {
        ...editableState,
        content: updateTemplateBlock(editableState.content, action.block)
      }
    case "delete_block":
      return {
        ...editableState,
        content: deleteTemplateBlock(editableState.content, action.blockId)
      }
    case "move_block":
      return {
        ...editableState,
        content: moveTemplateBlock(
          editableState.content,
          action.blockId,
          action.direction
        )
      }
  }
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

function toEditableTemplateEditorState(
  state: TemplateEditorState
): EditableTemplateEditorState {
  const content = upgradeV2TemplateContentToV3(state.content)

  if (content === state.content) {
    return state as EditableTemplateEditorState
  }

  return {
    ...state,
    content
  }
}
