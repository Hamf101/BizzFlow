import { fitRuns, ruleHasEffect, type TemplateBlock, type TemplateContentV3, type TextRun } from "@/types/template"
import {
  deleteTemplateBlock,
  evaluateTemplateBlockDeletion,
  insertTemplateBlock,
  removeTemplateSection,
  startTemplateSection,
  updateTemplateBlock,
  updateTemplateSection,
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
      .filter(ruleHasEffect),
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
 * The caret key of a section's title, which is typed on the page like a line.
 *
 * @param sectionId - The section.
 * @returns The key the canvas finds the title by.
 */
export function sectionTitleKey(sectionId: string): string {
  return `section:${sectionId}`
}

/**
 * The section whose title a caret key names.
 *
 * @param key - A caret key, or null.
 * @returns The section's id, or null when the key is not a section title's.
 */
export function sectionOfTitle(key: string | null): string | null {
  return key?.startsWith("section:") ? key.slice("section:".length) : null
}

/**
 * Starts a section after a block: at the block after it, or on a new empty
 * line when nothing follows or the next block already opens a section. The
 * caret goes to its editable placeholder title.
 *
 * @param content - The page.
 * @param afterBlockId - The block with the caret, or null for the top.
 * @param sectionId - A fresh id for the section.
 * @param newBlockId - A fresh id, used when a new line is needed.
 * @returns The page and where the caret goes.
 */
export function insertSectionAfter(
  content: TemplateContentV3,
  afterBlockId: string | null,
  sectionId: string,
  newBlockId: string
): { content: TemplateContentV3; focus: CaretTarget } {
  const next = content.blocks[content.blocks.findIndex((block) => block.id === afterBlockId) + 1]
  const placed = next !== undefined && !opensSection(content, next.id)
    ? content
    : insertTemplateBlock(content, afterBlockId, emptyParagraph(newBlockId))
  // Inserting a new section above the first one must not claim that section's body.
  const preserved = { ...placed, sections: content.sections }
  const changed = startTemplateSection(preserved, placed === content ? next!.id : newBlockId, sectionId, "Section title")

  return { content: changed, focus: { blockId: sectionTitleKey(sectionId), offset: 0 } }
}

/**
 * Turns a line into the title of a section holding what follows it. A page
 * break the line started moves to the section. The last line, or one before
 * another section, stays as the section's empty first line; a line that
 * already opens a section is left alone.
 *
 * @param content - The page.
 * @param blockId - The line.
 * @param sectionId - A fresh id for the section.
 * @returns The page and where the caret goes.
 */
export function turnLineIntoSection(
  content: TemplateContentV3,
  blockId: string,
  sectionId: string
): { content: TemplateContentV3; focus: CaretTarget } {
  const index = content.blocks.findIndex((block) => block.id === blockId)
  const line = content.blocks[index]

  if (!isLine(line) || line.text.trim().length > 160 || opensSection(content, blockId)) {
    return { content, focus: { blockId, offset: isLine(line) ? line.text.length : 0 } }
  }

  const next = content.blocks[index + 1]
  const holder = next !== undefined && !opensSection(content, next.id) ? next.id : blockId
  const without =
    holder === blockId
      ? removePageBreak({ ...content, blocks: content.blocks.map((block) => (block.id === blockId ? emptyParagraph(blockId) : block)) }, blockId)
      : deleteTemplateBlock(content, blockId)
  const started = startTemplateSection(without, holder, sectionId, line.text.trim() || "Section title")
  const changed = updateTemplateSection(started, sectionId, { pageBreakBefore: hasPageBreak(content, blockId) })

  return { content: changed, focus: { blockId: sectionTitleKey(sectionId), offset: line.text.length } }
}

/**
 * Turns a section's title back into a line where it stands, keeping what the
 * section held and any page break it started.
 *
 * @param content - The page.
 * @param sectionId - The section.
 * @param kind - The kind of line the title becomes.
 * @param newBlockId - A fresh id for the line.
 * @returns The page and where the caret goes.
 */
export function turnSectionIntoLine(
  content: TemplateContentV3,
  sectionId: string,
  kind: TextBlockKind,
  newBlockId: string
): { content: TemplateContentV3; focus: CaretTarget } {
  const section = content.sections.find((candidate) => candidate.id === sectionId)
  const startIndex = content.blocks.findIndex((block) => block.id === section?.startBlockId)

  if (!section || startIndex === -1) {
    return { content, focus: { blockId: sectionTitleKey(sectionId), offset: 0 } }
  }

  const text = section.label
  const line: TemplateBlock =
    kind.type === "heading"
      ? { alignment: "left", id: newBlockId, level: kind.level, text, type: "heading" }
      : { alignment: "left", id: newBlockId, text, type: "paragraph" }
  const placed = removeTemplateSection(insertTemplateBlock(content, content.blocks[startIndex - 1]?.id ?? null, line), sectionId)

  return {
    content: section.pageBreakBefore ? setPageBreak(placed, newBlockId) : placed,
    focus: { blockId: newBlockId, offset: text.length },
  }
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

/**
 * Takes out the words and blocks between two points on the page, as when a
 * selection across blocks is deleted or typed over. The words before the
 * first point and after the last join where the first point was, keeping
 * their formatting; blocks wholly between them go, fields and pictures too,
 * and a list keeps the items after the last point. The points can come in
 * either order.
 *
 * @param content - The page.
 * @param from - One end of the selection.
 * @param to - The other end.
 * @returns The page and where the caret goes, or why it cannot be done.
 */
export function deleteAcross(
  content: TemplateContentV3,
  from: CaretTarget,
  to: CaretTarget
): Readonly<{ content: TemplateContentV3; focus: CaretTarget | null; ok: true }> | Readonly<{ message: string; ok: false }> {
  const order = (point: CaretTarget): number[] => [content.blocks.findIndex((block) => block.id === point.blockId), point.item ?? 0, point.offset]
  const [first, last] = compareOrder(order(from), order(to)) <= 0 ? [from, to] : [to, from]
  const start = content.blocks.findIndex((block) => block.id === first.blockId)
  const end = content.blocks.findIndex((block) => block.id === last.blockId)
  const head = entriesOf(content.blocks[start])
  const tail = entriesOf(content.blocks[end])
  const firstItem = first.item ?? 0
  const lastItem = last.item ?? 0
  const before = head ? [...head.slice(0, firstItem), cut(head[firstItem], 0, first.offset)] : null
  const after = tail ? [cut(tail[lastItem], last.offset), ...tail.slice(lastItem + 1)] : null
  // What goes whole: the blocks between, and an end that is not words.
  const gone = content.blocks
    .slice(start, end + 1)
    .filter((block, index) => (index > 0 && index < end - start) || (index === 0 && !before) || (index === end - start && !after && start !== end))
    .map((block) => block.id)

  if (start < 0 || end < 0) {
    return { message: "The selection is no longer on the page.", ok: false }
  }

  let blocks = content.blocks

  for (const id of gone) {
    const allowed = evaluateTemplateBlockDeletion(blocks, id)

    if (!allowed.success) {
      return { message: allowed.message, ok: false }
    }

    blocks = blocks.filter((block) => block.id !== id)
  }

  let next = gone.reduce((page, id) => deleteTemplateBlock(page, id), content)

  if (before) {
    // The words after the last point join the first block, when both are words.
    const joined = after ? [...before.slice(0, -1), joinEntries(before.at(-1)!, after[0]!)] : before
    const rest = after?.slice(1) ?? []

    next = updateTemplateBlock(next, withAll(content.blocks[start]!, start === end ? [...joined, ...rest] : joined))

    if (start !== end && after) {
      next = rest.length ? updateTemplateBlock(next, withAll(content.blocks[end]!, rest)) : deleteTemplateBlock(next, last.blockId)
    }

    return { content: next, focus: { blockId: first.blockId, ...(first.item === undefined ? {} : { item: firstItem }), offset: first.offset }, ok: true }
  }

  if (after) {
    next = updateTemplateBlock(next, withAll(content.blocks[end]!, after))

    return { content: next, focus: { blockId: last.blockId, ...(last.item === undefined ? {} : { item: 0 }), offset: 0 }, ok: true }
  }

  return { content: next, focus: null, ok: true }
}

/**
 * Puts words in at the caret, a line or several: the first joins the words
 * before the caret, each next one starts a line of its own (an item, in a
 * list), and the words after the caret follow the last. Blank lines between
 * are dropped.
 *
 * @param content - The page.
 * @param at - The caret.
 * @param lines - The lines put in.
 * @param newId - Makes an id for each new line.
 * @returns The page, and the caret at the end of the pasted words.
 */
export function insertLines(content: TemplateContentV3, at: CaretTarget, lines: readonly string[], newId: () => string): { content: TemplateContentV3; focus: CaretTarget } {
  const block = content.blocks.find((candidate) => candidate.id === at.blockId)
  const entries = entriesOf(block)
  const kept = lines.filter((line, index) => line.trim() || index === 0 || index === lines.length - 1)

  if (!block || !entries || kept.length === 0) {
    return { content, focus: at }
  }

  const item = at.item ?? 0
  const entry = entries[item]!
  const pasted: ListEntry[] =
    kept.length === 1
      ? [joinEntries(joinEntries(cut(entry, 0, at.offset), { text: kept[0]! }), cut(entry, at.offset))]
      : [
          joinEntries(cut(entry, 0, at.offset), { text: kept[0]! }),
          ...kept.slice(1, -1).map((text) => ({ text })),
          joinEntries({ text: kept.at(-1)! }, cut(entry, at.offset)),
        ]
  const offset = (kept.length === 1 ? at.offset : 0) + kept.at(-1)!.length

  if (isList(block)) {
    const listed = withEntries(block, [...entries.slice(0, item), ...pasted, ...entries.slice(item + 1)])

    return { content: updateTemplateBlock(content, listed), focus: { blockId: block.id, item: item + pasted.length - 1, offset } }
  }

  let next = updateTemplateBlock(content, withAll(block, [pasted[0]!]))
  let previous = block.id

  for (const line of pasted.slice(1)) {
    const id = newId()

    next = insertTemplateBlock(next, previous, { alignment: "left", id, runs: line.runs, text: line.text, type: "paragraph" })
    previous = id
  }

  return { content: next, focus: { blockId: previous, offset } }
}

// A block's words as entries: one for a line, one for each item of a list,
// and none for a block that is not words.
function entriesOf(block: TemplateBlock | undefined): ListEntry[] | null {
  return isLine(block) ? [{ runs: block.runs, text: block.text }] : isList(block) ? listEntries(block) : null
}

// A block given back its entries: a line takes the first.
function withAll(block: TemplateBlock, entries: readonly ListEntry[]): TemplateBlock {
  if (isList(block)) {
    return withEntries(block, entries)
  }

  const [line = { text: "" }] = entries

  return isLine(block) ? { ...block, runs: fitRuns(line.text, line.runs), text: line.text } : block
}

function cut(entry: ListEntry | undefined, start: number, end = Infinity): ListEntry {
  return { runs: sliceRuns(entry?.runs, start, end), text: (entry?.text ?? "").slice(start, end) }
}

function joinEntries(left: ListEntry, right: ListEntry): ListEntry {
  return { runs: joinRuns(left, right), text: left.text + right.text }
}

function compareOrder(left: readonly number[], right: readonly number[]): number {
  const index = left.findIndex((value, at) => value !== right[at])

  return index < 0 ? 0 : (left[index] ?? 0) - (right[index] ?? 0)
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

function opensSection(content: TemplateContentV3, blockId: string): boolean {
  return content.sections.some((section) => section.startBlockId === blockId)
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
