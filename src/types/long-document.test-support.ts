import { createBlankTemplateContent, type TemplateBlock, type TemplateContentV3 } from "@/types/template"

const CLAUSE =
  "The supplier carries out the services with reasonable care and skill, keeps the client informed of progress, and tells the client promptly of anything that may delay the work or change its cost. "

/**
 * A long agreement, about a page for each part: a heading, three paragraphs
 * of clauses and three fields, then a price list running over several pages.
 *
 * @param parts - How many parts; 50 prints on a little over 50 pages.
 * @returns Valid content, with ids and field keys unique across the document.
 */
export function createLongDocumentContent(parts = 50): TemplateContentV3 {
  let count = 0
  const id = (): string => `70000000-0000-4000-8000-${String((count += 1)).padStart(12, "0")}`
  const blocks: TemplateBlock[] = []

  for (let part = 1; part <= parts; part += 1) {
    blocks.push(
      { id: id(), type: "heading", text: `Part ${part}: services and terms`, level: 2, alignment: "left" },
      ...[1, 2, 3].map((clause): TemplateBlock => ({ id: id(), type: "paragraph", text: `${part}.${clause} ${CLAUSE.repeat(3)}`, alignment: "left" })),
      { id: id(), type: "text_field", fieldKey: `part_${part}_contact`, label: `Contact for part ${part}`, required: false, helpText: null, placeholder: null, multiline: false },
      { id: id(), type: "date_field", fieldKey: `part_${part}_start`, label: `Part ${part} start date`, required: false, helpText: null },
      { id: id(), type: "checkbox_field", fieldKey: `part_${part}_agreed`, label: `Part ${part} agreed`, required: false, helpText: null, checkedByDefault: false }
    )
  }

  blocks.push({
    id: id(),
    type: "table",
    headers: ["Item", "Quantity", "Unit price", "Amount"],
    rows: Array.from({ length: 300 }, (_, row) => [`Item ${row + 1}`, "", "", ""]),
  })

  return { ...createBlankTemplateContent(), blocks }
}
