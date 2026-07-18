import type {
  TemplateBlock,
  TemplateBranding,
  TemplateContent,
} from "@/types/template"

const PLACEHOLDER_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

export type TemplateSectionKey = keyof TemplateContent["sections"]

export type TemplateEditorState = {
  title: string
  description: string
  content: TemplateContent
}

export type TemplateEditorAction =
  | { type: "set_title"; value: string }
  | { type: "set_description"; value: string }
  | { type: "set_branding"; value: TemplateBranding }
  | {
      type: "set_repeat"
      section: "header" | "footer"
      value: boolean
    }
  | { type: "add_block"; section: TemplateSectionKey; block: TemplateBlock }
  | {
      type: "update_block"
      section: TemplateSectionKey
      block: TemplateBlock
    }
  | {
      type: "delete_block"
      section: TemplateSectionKey
      blockId: string
    }
  | {
      type: "move_block"
      section: TemplateSectionKey
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
  switch (action.type) {
    case "set_title":
      return { ...state, title: action.value }
    case "set_description":
      return { ...state, description: action.value }
    case "set_branding":
      return {
        ...state,
        content: { ...state.content, branding: action.value },
      }
    case "set_repeat":
      return {
        ...state,
        content: {
          ...state.content,
          repeat: {
            ...state.content.repeat,
            [action.section]: action.value,
          },
        },
      }
    case "add_block":
      return updateSectionBlocks(state, action.section, (blocks) => [
        ...blocks,
        action.block,
      ])
    case "update_block":
      return updateSectionBlocks(state, action.section, (blocks) =>
        blocks.map((block: TemplateBlock) =>
          block.id === action.block.id ? action.block : block
        )
      )
    case "delete_block":
      return updateSectionBlocks(state, action.section, (blocks) =>
        blocks.filter((block: TemplateBlock) => block.id !== action.blockId)
      )
    case "move_block":
      return updateSectionBlocks(state, action.section, (blocks) =>
        moveBlock(blocks, action.blockId, action.direction)
      )
  }
}

/**
 * Creates a schema-shaped starter block for a user-selected block type.
 *
 * @param blockType - Canonical discriminant for the requested block.
 * @returns A new block with a UUID and clear editable defaults.
 */
export function createTemplateBlock(
  blockType: TemplateBlock["type"]
): TemplateBlock {
  const id = crypto.randomUUID()
  const fieldKey = `${blockType.replace("_field", "")}_${id.replaceAll("-", "").slice(0, 8)}`
  const fieldDefaults = {
    id,
    fieldKey,
    label: "New field",
    required: false,
    helpText: null,
  }

  switch (blockType) {
    case "heading":
      return { id, type: blockType, text: "New heading", level: 2, alignment: "left" }
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
        widthPercent: 100,
      }
    case "table":
      return {
        id,
        type: blockType,
        headers: ["Column 1", "Column 2"],
        rows: [["", ""]],
      }
    case "divider":
      return { id, type: blockType }
    case "text_field":
      return {
        ...fieldDefaults,
        type: blockType,
        placeholder: null,
        multiline: false,
      }
    case "date_field":
      return { ...fieldDefaults, type: blockType }
    case "checkbox_field":
      return { ...fieldDefaults, type: blockType, checkedByDefault: false }
    case "dropdown_field":
      return {
        ...fieldDefaults,
        type: blockType,
        placeholder: "Select an option",
        options: ["Option 1"],
      }
    case "initials_field":
      return { ...fieldDefaults, type: blockType }
    case "signature_field":
      return { ...fieldDefaults, type: blockType }
  }
}

function updateSectionBlocks(
  state: TemplateEditorState,
  section: TemplateSectionKey,
  update: (blocks: TemplateBlock[]) => TemplateBlock[]
): TemplateEditorState {
  const currentSection = state.content.sections[section]

  return {
    ...state,
    content: {
      ...state.content,
      sections: {
        ...state.content.sections,
        [section]: {
          ...currentSection,
          blocks: update(currentSection.blocks),
        },
      },
    },
  }
}

function moveBlock(
  blocks: TemplateBlock[],
  blockId: string,
  direction: "up" | "down"
): TemplateBlock[] {
  const index = blocks.findIndex((block: TemplateBlock) => block.id === blockId)
  const targetIndex = direction === "up" ? index - 1 : index + 1

  if (index < 0 || targetIndex < 0 || targetIndex >= blocks.length) {
    return blocks
  }

  const reorderedBlocks = [...blocks]
  const [selectedBlock] = reorderedBlocks.splice(index, 1)

  if (!selectedBlock) {
    return blocks
  }

  reorderedBlocks.splice(targetIndex, 0, selectedBlock)
  return reorderedBlocks
}
