import type { TemplateBlock } from "@/types/template"

// Kept apart from the schemas, so pages in the browser can ask without
// carrying every schema with them.

/** Most rows a fillable table may hold once a person has added to it. */
export const MAX_TABLE_FIELD_ROWS = 100

/**
 * Whether a field's answer is a list or a record rather than one value: a
 * several-choice dropdown, a choice grid or a table.
 *
 * @param block - Any template block.
 * @returns `true` when the answer travels as JSON.
 */
export function isStructuredAnswerBlock(block: TemplateBlock): boolean {
  return (
    (block.type === "dropdown_field" && block.multiple === true) ||
    block.type === "choice_grid_field" ||
    block.type === "table_field"
  )
}
