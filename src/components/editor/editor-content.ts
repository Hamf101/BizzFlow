import { fitRuns, type TemplateBlock, type TemplateContentV3, type TextRun } from "@/types/template"
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

  const kept = updateTemplateBlock(content, {
    ...block,
    runs: sliceRuns(block.runs, 0, offset),
    text: block.text.slice(0, offset),
  })
  const next: TemplateBlock = {
    alignment: block.type === "paragraph" ? block.alignment : "left",
    id: newBlockId,
    runs: sliceRuns(block.runs, offset),
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
    const joined = updateTemplateBlock(content, {
      ...previous,
      runs: joinRuns(previous, block),
      text: previous.text + block.text,
    })

    return {
      content: deleteTemplateBlock(joined, blockId),
      focus: { blockId: previous.id, offset: previous.text.length },
    }
  }

  if (isList(previous)) {
    const last = previous.items.length - 1
    const entries = listEntries(previous).map((entry, itemIndex) =>
      itemIndex === last ? { runs: joinRuns(entry, block), text: entry.text + block.text } : entry
    )

    return {
      content: deleteTemplateBlock(updateTemplateBlock(content, withEntries(previous, entries)), blockId),
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
 * @param words - The words to keep, with their formatting, when they differ from what is stored.
 * @returns The page and a caret at the end of the line.
 */
export function convertTextBlock(
  content: TemplateContentV3,
  blockId: string,
  kind: TextBlockKind,
  words?: ListEntry
): { content: TemplateContentV3; focus: CaretTarget } {
  const block = content.blocks.find((candidate) => candidate.id === blockId)

  if (!isLine(block) && !isList(block)) {
    return { content, focus: { blockId, offset: 0 } }
  }

  // A list's items become one line, a space between each, formatting and all.
  const whole = isList(block)
    ? { runs: joinRuns(...listEntries(block).flatMap((entry, index) => (index > 0 ? [{ text: " " }, entry] : [entry]))), text: block.items.join(" ") }
    : { runs: block.runs, text: block.text }
  const { runs, text } = words ?? whole
  const alignment = isLine(block) ? block.alignment : "left"
  const next: TemplateBlock =
    kind.type === "heading"
      ? { alignment, id: blockId, level: kind.level, runs, text, type: "heading" }
      : kind.type === "paragraph"
        ? { alignment, id: blockId, runs, text, type: "paragraph" }
        : withEntries({ id: blockId, items: [], type: kind.type }, [{ runs, text }])

  return {
    content: updateTemplateBlock(content, next),
    focus: { blockId, item: isList(next) ? 0 : undefined, offset: text.length },
  }
}

/**
 * Lifts one list item out as a line of its own, where it stands: the items
 * before it stay a list above it, and those after it become a list below.
 * A list of one simply becomes the line.
 *
 * @param content - The page.
 * @param blockId - The list.
 * @param item - The item to lift out.
 * @param kind - The kind of line it becomes.
 * @param ids - Fresh ids for the line and for the list after it.
 * @returns The page and a caret at the start of the line.
 */
export function liftListItem(
  content: TemplateContentV3,
  blockId: string,
  item: number,
  kind: Extract<TextBlockKind, { type: "heading" | "paragraph" }>,
  ids: readonly [line: string, rest: string]
): { content: TemplateContentV3; focus: CaretTarget } {
  const block = content.blocks.find((candidate) => candidate.id === blockId)

  if (!isList(block)) {
    return { content, focus: { blockId, offset: 0 } }
  }

  const entries = listEntries(block)
  const { runs, text } = entries[item] ?? { text: "" }
  const before = entries.slice(0, item)
  const after = entries.slice(item + 1)

  if (before.length === 0 && after.length === 0) {
    return { ...convertTextBlock(content, blockId, kind, { runs, text }), focus: { blockId, offset: 0 } }
  }

  const [lineId, restId] = ids
  const line: TemplateBlock =
    kind.type === "heading"
      ? { alignment: "left", id: lineId, level: kind.level, runs, text, type: "heading" }
      : { alignment: "left", id: lineId, runs, text, type: "paragraph" }
  const index = content.blocks.indexOf(block)
  const kept = before.length > 0 ? updateTemplateBlock(content, withEntries(block, before)) : content
  const placed = insertTemplateBlock(kept, before.length > 0 ? blockId : (content.blocks[index - 1]?.id ?? null), line)

  return {
    content:
      before.length === 0
        ? updateTemplateBlock(placed, withEntries(block, after))
        : after.length > 0
          ? insertTemplateBlock(placed, lineId, withEntries({ id: restId, items: [], type: block.type }, after))
          : placed,
    focus: { blockId: lineId, offset: 0 },
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
        const entries = listEntries(block)
          .map((entry) => ({ runs: fitRuns(entry.text.trim(), entry.runs), text: entry.text.trim() }))
          .filter((entry) => entry.text)

        return entries.length > 0
          ? withEntries(block, entries)
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

/** One list item with its formatting, as the canvas edits items. */
export type ListEntry = Readonly<{ runs?: TextRun[]; text: string }>

/**
 * A list's items beside their formatting.
 *
 * @param block - The list.
 * @returns One entry for each item.
 */
export function listEntries(block: ListBlock): ListEntry[] {
  return block.items.map((text, index): ListEntry => ({ runs: block.itemRuns?.[index] ?? undefined, text }))
}

/**
 * Puts a list's items back from entries, keeping formatting only when some
 * item has any.
 *
 * @param block - The list.
 * @param entries - Its items with their formatting.
 * @returns The list with those items.
 */
export function withEntries<Block extends ListBlock>(block: Block, entries: readonly ListEntry[]): Block {
  const itemRuns = entries.map((entry) => entry.runs ?? null)

  return {
    ...block,
    itemRuns: itemRuns.some(Boolean) ? itemRuns : undefined,
    items: entries.map((entry) => entry.text),
  }
}

/**
 * The formatting of part of a text, from one character up to another.
 *
 * @param runs - The whole text's formatting, if it has any.
 * @param start - Where the part starts.
 * @param end - Where it ends; the end of the text when left out.
 * @returns The part's formatting, or undefined when it is plain.
 */
export function sliceRuns(runs: readonly TextRun[] | undefined, start: number, end = Infinity): TextRun[] | undefined {
  const part: TextRun[] = []
  let at = 0

  for (const run of runs ?? []) {
    const text = run.text.slice(Math.max(0, start - at), Math.max(0, end - at))

    if (text) {
      part.push({ ...run, text })
    }

    at += run.text.length
  }

  return fitRuns(part.map((run) => run.text).join(""), part)
}

/**
 * The formatting of texts set one after another.
 *
 * @param parts - Each text with its formatting, if it has any.
 * @returns The joined formatting, or undefined when all of it is plain.
 */
export function joinRuns(...parts: ReadonlyArray<Readonly<{ runs?: readonly TextRun[]; text: string }>>): TextRun[] | undefined {
  const runs = parts.flatMap((part) => part.runs ?? (part.text ? [{ text: part.text }] : []))

  return fitRuns(runs.map((run) => run.text).join(""), runs)
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
