import { normalizeContentForSave } from "@/components/editor/editor-content"
import { templateContentV3Schema, type TemplateBlock, type TemplateContentV3 } from "@/types/template"

import type { WorkingCopy } from "./working-copy-doc"

// What a blank still being typed stands in for, so the rest can be checked.
const STAND_IN = "…"

/**
 * Whether a working copy is fit to share while people edit it: everything in
 * it is something saving accepts, except the blanks of words still being
 * typed, such as a label cleared to write a new one.
 *
 * @param value - The working copy read from a shared document.
 * @returns Whether it may be kept and passed on.
 */
export function isWellFormedWorkingCopy(value: WorkingCopy): boolean {
  try {
    return (
      value.title.length <= 180 &&
      (value.description ?? "").length <= 2_000 &&
      (value.category ?? "").trim().length <= 40 &&
      templateContentV3Schema.safeParse(normalizeContentForSave(withBlanksFilled(value.content))).success
    )
  } catch {
    return false
  }
}

/**
 * Content as saving keeps it, once nothing in it is still being typed: what
 * the editor has always sent to be saved, checked the same way.
 *
 * @param content - The content of a working copy.
 * @returns The content to save, or null while it is unfinished.
 */
export function savedContentOf(content: TemplateContentV3): TemplateContentV3 | null {
  const parsed = templateContentV3Schema.safeParse(normalizeContentForSave(content))
  return parsed.success ? parsed.data : null
}

function withBlanksFilled(content: TemplateContentV3): TemplateContentV3 {
  const filled = (text: string): string => (text.trim() ? text : STAND_IN)
  const { printedTitle } = content.layout

  return {
    ...content,
    blocks: content.blocks.map((block): TemplateBlock => {
      switch (block.type) {
        case "image":
          return { ...block, altText: filled(block.altText) }
        case "dropdown_field":
          return { ...block, label: filled(block.label), options: block.options.map(filled) }
        default:
          return "fieldKey" in block ? { ...block, label: filled(block.label) } : block
      }
    }),
    fieldGroups: content.fieldGroups.map((group) => (group.label === null ? group : { ...group, label: filled(group.label) })),
    layout: printedTitle.mode === "custom" ? { ...content.layout, printedTitle: { ...printedTitle, text: filled(printedTitle.text) } } : content.layout,
    sections: content.sections.map((section) => ({ ...section, label: filled(section.label) })),
  }
}
