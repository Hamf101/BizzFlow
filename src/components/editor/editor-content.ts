import type { TemplateBlock, TemplateContentV3 } from "@/types/template"
import {
  deleteTemplateBlock,
  insertTemplateBlock,
  updateTemplateBlock,
} from "@/types/template-structure"

/** Where the caret goes after an edit: a block, and an item for lists. */
export type CaretTarget = Readonly<{ blockId: string; item?: number; offset: number }>

/** The kinds of line a person can type and turn into one another. */
export type TextBlockKind =
  | Readonly<{ type: "paragraph" }>
  | Readonly<{ type: "heading"; level: 1 | 2 | 3 }>
  | Readonly<{ type: "bullet_list" }>
  | Readonly<{ type: "numbered_list" }>

type LineBlock = Extract<TemplateBlock, { type: "heading" | "paragraph" }>
type TemplateBlockRule = TemplateContentV3["blockRules"][number]
type ListBlock = Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>

/**
 * Presses Enter in a line of text. The text after the caret moves to a new
 * line below; at the start of a line that has text, an empty line opens above
 * instead, and the caret stays put.
 *
 * @param content - The page.
 * @param blockId - The line with the caret.
 * @param offset - The caret's position in the line.
 * @param newBlockId - A fresh id for the new line.
 * @returns The page and where the caret goes.
 */
export function splitTextBlock(
  content: TemplateContentV3,
  blockId: string,
  offset: number,
  newBlockId: string
): { content: TemplateContentV3; focus: CaretTarget } {
  const index = content.blocks.findIndex((block) => block.id === blockId)
  const block = content.blocks[index]

  if (!isLine(block)) {
    return { content, focus: { blockId, offset } }
  }

  if (offset === 0 && block.text.length > 0) {
    const opened = insertTemplateBlock(
      content,
      content.blocks[index - 1]?.id ?? null,
      emptyParagraph(newBlockId)
    )

    // A page break belongs to whatever now starts the page.
    return {
      content: hasPageBreak(content, blockId)
        ? setPageBreak(removePageBreak(opened, blockId), newBlockId)
        : opened,
      focus: { blockId, offset: 0 },
    }
  }

  const kept = updateTemplateBlock(content, { ...block, text: block.text.slice(0, offset) })
  const next: TemplateBlock = {
    alignment: block.type === "paragraph" ? block.alignment : "left",
    id: newBlockId,
    text: block.text.slice(offset),
    type: "paragraph",
  }

  return {
    content: insertTemplateBlock(kept, blockId, next),
    focus: { blockId: newBlockId, offset: 0 },
  }
}

/**
 * Presses Backspace at the start of a line. A page break before the line goes
 * first; otherwise the line joins the text above it. Above a field, table,
 * image or divider, an empty line is removed and a line with text stays.
 *
 * @param content - The page.
 * @param blockId - The line with the caret at its start.
 * @returns The page, and where the caret goes or which block is selected.
 */
export function mergeIntoPrevious(
  content: TemplateContentV3,
  blockId: string
): { content: TemplateContentV3; focus?: CaretTarget; select?: string } {
  const index = content.blocks.findIndex((block) => block.id === blockId)
  const block = content.blocks[index]
  const previous = content.blocks[index - 1]

  if (!isLine(block)) {
    return { content }
  }

  if (hasPageBreak(content, blockId)) {
    return { content: removePageBreak(content, blockId), focus: { blockId, offset: 0 } }
  }

  if (!previous) {
    return { content, focus: { blockId, offset: 0 } }
  }

  if (isLine(previous)) {
    const joined = updateTemplateBlock(content, { ...previous, text: previous.text + block.text })

    return {
      content: deleteTemplateBlock(joined, blockId),
      focus: { blockId: previous.id, offset: previous.text.length },
    }
  }

  if (isList(previous)) {
    const last = previous.items.length - 1
    const items = previous.items.map((item, itemIndex) =>
      itemIndex === last ? item + block.text : item
    )

    return {
      content: deleteTemplateBlock(updateTemplateBlock(content, { ...previous, items }), blockId),
      focus: { blockId: previous.id, item: last, offset: previous.items[last]?.length ?? 0 },
    }
  }

  return {
    content: block.text.length === 0 ? deleteTemplateBlock(content, blockId) : content,
    select: previous.id,
  }
}

/**
 * Reads a markdown shortcut typed at the start of an otherwise empty line.
 *
 * @param text - Everything typed in the line so far.
 * @returns The kind of line it asks for, or null.
 */
export function readMarkdownShortcut(text: string): TextBlockKind | null {
  switch (text) {
    case "# ":
      return { level: 1, type: "heading" }
    case "## ":
      return { level: 2, type: "heading" }
    case "### ":
      return { level: 3, type: "heading" }
    case "- ":
    case "* ":
      return { type: "bullet_list" }
    case "1. ":
      return { type: "numbered_list" }
    default:
      return null
  }
}

/**
 * Turns a line of text into another kind of line, keeping its words.
 *
 * @param content - The page.
 * @param blockId - The line to turn.
 * @param kind - What it becomes.
 * @param text - The line's text to keep, when it differs from what is stored.
 * @returns The page and a caret at the end of the line.
 */
export function convertTextBlock(
  content: TemplateContentV3,
  blockId: string,
  kind: TextBlockKind,
  text?: string
): { content: TemplateContentV3; focus: CaretTarget } {
  const block = content.blocks.find((candidate) => candidate.id === blockId)

  if (!isLine(block) && !isList(block)) {
    return { content, focus: { blockId, offset: 0 } }
  }

  const words = text ?? (isList(block) ? block.items.join(" ") : block.text)
  const alignment = isLine(block) ? block.alignment : "left"
  const next: TemplateBlock =
    kind.type === "heading"
      ? { alignment, id: blockId, level: kind.level, text: words, type: "heading" }
      : kind.type === "paragraph"
        ? { alignment, id: blockId, text: words, type: "paragraph" }
        : { id: blockId, items: [words], type: kind.type }

  return {
    content: updateTemplateBlock(content, next),
    focus: { blockId, item: isList(next) ? 0 : undefined, offset: words.length },
  }
}

/**
 * Adds a page after a block: an empty line that starts the next page.
 *
 * @param content - The page.
 * @param afterBlockId - The last block before the new page, or null for the start.
 * @param newBlockId - A fresh id for the new page's first line.
 * @returns The content with the new page.
 */
export function insertPageAfter(
  content: TemplateContentV3,
  afterBlockId: string | null,
  newBlockId: string
): TemplateContentV3 {
  return setPageBreak(insertTemplateBlock(content, afterBlockId, emptyParagraph(newBlockId)), newBlockId)
}

/**
 * Takes away the page break before a block, keeping everything typed.
 *
 * @param content - The page.
 * @param blockId - The block that starts a page.
 * @returns The content with the block flowing on from the page before.
 */
export function removePageBreak(
  content: TemplateContentV3,
  blockId: string
): TemplateContentV3 {
  return {
    ...content,
    blockRules: content.blockRules
      .map((rule: TemplateBlockRule) =>
        rule.blockId === blockId ? { ...rule, pageBreakBefore: false } : rule
      )
      .filter((rule: TemplateBlockRule) => rule.pageBreakBefore || rule.keepWithNext),
    sections: content.sections.map((section) =>
      section.startBlockId === blockId ? { ...section, pageBreakBefore: false } : section
    ),
  }
}

/**
 * Says whether a block starts a new page.
 *
 * @param content - The page.
 * @param blockId - The block.
 * @returns True when a rule or its section breaks the page before it.
 */
export function hasPageBreak(content: TemplateContentV3, blockId: string): boolean {
  return (
    content.blockRules.some((rule) => rule.blockId === blockId && rule.pageBreakBefore) ||
    content.sections.some(
      (section) => section.startBlockId === blockId && section.pageBreakBefore
    )
  )
}

/**
 * Makes what was typed valid to save: an emptied heading becomes an empty
 * line, empty list items go, and a list with none left becomes an empty line.
 *
 * @param content - The page as edited.
 * @returns Content the schema accepts, with every block id kept.
 */
export function normalizeContentForSave(content: TemplateContentV3): TemplateContentV3 {
  return {
    ...content,
    blocks: content.blocks.map((block: TemplateBlock): TemplateBlock => {
      if (block.type === "heading" && block.text.trim().length === 0) {
        return { alignment: block.alignment, id: block.id, text: "", type: "paragraph" }
      }

      if (isList(block)) {
        const items = block.items.map((item) => item.trim()).filter(Boolean)

        return items.length > 0
          ? { ...block, items }
          : { alignment: "left", id: block.id, text: "", type: "paragraph" }
      }

      if (block.type === "table") {
        return {
          ...block,
          headers: block.headers.map((header, index) => header.trim() || `Column ${index + 1}`),
        }
      }

      return block
    }),
  }
}

function setPageBreak(content: TemplateContentV3, blockId: string): TemplateContentV3 {
  const existing = content.blockRules.find((rule) => rule.blockId === blockId)

  return {
    ...content,
    blockRules: existing
      ? content.blockRules.map((rule) =>
          rule.blockId === blockId ? { ...rule, pageBreakBefore: true } : rule
        )
      : [...content.blockRules, { blockId, keepWithNext: false, pageBreakBefore: true }],
  }
}

function emptyParagraph(id: string): TemplateBlock {
  return { alignment: "left", id, text: "", type: "paragraph" }
}

function isLine(block: TemplateBlock | undefined): block is LineBlock {
  return block?.type === "paragraph" || block?.type === "heading"
}

function isList(block: TemplateBlock | undefined): block is ListBlock {
  return block?.type === "bullet_list" || block?.type === "numbered_list"
}
