import * as Y from "yjs"

import { fitRuns, type TemplateBlock, type TemplateContentV3, type TextRun } from "@/types/template"
import { withoutImageUrls } from "@/types/template-images"
import { repairTemplateStructure, withGeneratedFieldKeys } from "@/types/template-structure"

/**
 * A working copy as people edit it together: a template's title, description,
 * category and pages, or a draft document's title, pages and answers.
 */
export type WorkingCopy = Readonly<{
  answers?: Readonly<Record<string, unknown>>
  category?: string
  content: TemplateContentV3
  description?: string
  title: string
}>

type Marks = Record<string, unknown>
type Run = Readonly<{ marks: Marks; text: string }>

const ROOT = "workingCopy"
const LINE_TYPES: ReadonlySet<TemplateBlock["type"]> = new Set(["heading", "paragraph"])
const LIST_TYPES: ReadonlySet<TemplateBlock["type"]> = new Set(["bullet_list", "numbered_list"])

/**
 * An empty shared document for a working copy. After changes from elsewhere,
 * Yjs tidies away formatting markers it thinks spare, as a change of this copy's
 * own that nobody else makes; the server never passes its tidy-ups on, and a
 * copy that tidied can disagree with one that didn't once later changes arrive
 * about which words are bold. So no copy tidies on its own: formatting changes
 * only by editing, which everyone receives.
 *
 * @returns The document.
 */
export function newWorkingCopyDoc(): Y.Doc {
  const doc = new Y.Doc()

  // ponytail: yjs 13.6 reads this private flag straight after afterTransaction; the
  // test where two people bold one word at once catches an upgrade that moves it.
  doc.on("afterTransaction", (transaction: Y.Transaction) => {
    ;(transaction as unknown as { _needFormattingCleanup: boolean })._needFormattingCleanup = false
  })

  return doc
}

/**
 * Starts the shared document for a working copy. The server makes it once, so
 * everyone edits the same history rather than two copies of the same words.
 *
 * @param value - The working copy as saved.
 * @returns A document holding it.
 */
export function createWorkingCopyDoc(value: WorkingCopy): Y.Doc {
  const doc = newWorkingCopyDoc()
  const root = doc.getMap<unknown>(ROOT)

  doc.transact(() => {
    root.set("title", new Y.Text())
    root.set("order", new Y.Array<string>())
    root.set("blocks", new Y.Map<Y.Map<unknown>>())
    root.set("sections", new Y.Map<unknown>())
    root.set("fieldGroups", new Y.Map<unknown>())
    root.set("blockRules", new Y.Map<unknown>())
    if (value.description !== undefined) root.set("description", new Y.Text())
    if (value.answers !== undefined) root.set("answers", new Y.Map<unknown>())
  })
  writeWorkingCopyDoc(doc, value)

  return doc
}

/**
 * Reads the working copy a shared document holds. Edits that met can leave
 * structure without its blocks, or two fields asking for one key; what is
 * read lets those go the same way on every copy, so everyone sees one page.
 *
 * @param doc - The shared document.
 * @returns The working copy, its structure settled.
 * @throws When the document is not shaped like a working copy.
 */
export function readWorkingCopyDoc(doc: Y.Doc): WorkingCopy {
  const root = doc.getMap<unknown>(ROOT)
  const order = asType(root.get("order"), Y.Array<string>)
  const blocks = asType(root.get("blocks"), Y.Map<unknown>)
  const ids = [...new Set(order.toArray())].filter((blockId) => typeof blockId === "string" && blocks.has(blockId))
  const position = new Map(ids.map((blockId, index) => [blockId, index]))
  const at = (blockId: unknown): number => position.get(blockId as string) ?? Number.MAX_SAFE_INTEGER
  const values = (key: string): Array<Record<string, unknown>> =>
    [...asType(root.get(key), Y.Map<unknown>).values()].filter(isRecord)
  const byPlace = (place: (entry: Record<string, unknown>) => unknown, tie: string) =>
    (left: Record<string, unknown>, right: Record<string, unknown>): number =>
      at(place(left)) - at(place(right)) || String(left[tie]).localeCompare(String(right[tie]))
  const content = {
    schemaVersion: root.get("schemaVersion"),
    branding: root.get("branding"),
    blocks: ids.map((blockId) => readBlock(asType(blocks.get(blockId), Y.Map<unknown>))),
    layout: root.get("layout"),
    sections: values("sections").sort(byPlace((section) => section.startBlockId, "id")),
    fieldGroups: values("fieldGroups").sort(byPlace((group) => group.startBlockId, "id")),
    blockRules: values("blockRules").sort(byPlace((rule) => rule.blockId, "blockId")),
  } as TemplateContentV3
  const description = root.get("description")
  const category = root.get("category")
  const answers = root.get("answers")

  return {
    ...(answers === undefined ? {} : { answers: sortedObject(asType(answers, Y.Map<unknown>).toJSON()) }),
    ...(typeof category === "string" ? { category } : {}),
    content: withGeneratedFieldKeys(repairTemplateStructure(content)),
    ...(description === undefined ? {} : { description: asType(description, Y.Text).toString() }),
    title: asType(root.get("title"), Y.Text).toString(),
  }
}

/**
 * The part of a shared document that holds the working copy, which is what an
 * editor's undo covers.
 *
 * @param doc - The shared document.
 * @returns Its working copy's top-level map.
 */
export function workingCopyRoot(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(ROOT)
}

/**
 * Whether a shared document holds nothing but its working copy, so an update
 * cannot tuck anything else into what everyone keeps.
 *
 * @param doc - The shared document.
 * @returns Whether its only top-level entry is the working copy.
 */
export function holdsOnlyWorkingCopy(doc: Y.Doc): boolean {
  return [...doc.share.keys()].every((name) => name === ROOT)
}

/**
 * Writes a working copy into a shared document as the smallest changes that
 * get it there: words typed, formatting set, a block moved rather than
 * rebuilt. Other people's changes to what was not touched survive the merge.
 *
 * @param doc - The shared document.
 * @param value - The working copy it should now hold.
 * @param options - Who is changing it, and the copy last read from it, so
 *   blocks that are the very same object are skipped.
 */
export function writeWorkingCopyDoc(
  doc: Y.Doc,
  value: WorkingCopy,
  options: Readonly<{ from?: WorkingCopy; origin?: unknown }> = {}
): void {
  const root = doc.getMap<unknown>(ROOT)
  const before = new Map(options.from?.content.blocks.map((block) => [block.id, block]))
  // Pictures' addresses are signed for one viewer and expire; only the pictures are shared.
  const content = withoutImageUrls(value.content)

  doc.transact(() => {
    writeText(asType(root.get("title"), Y.Text), [{ marks: {}, text: value.title }])
    if (value.description !== undefined) writeText(asType(root.get("description"), Y.Text), [{ marks: {}, text: value.description }])
    if (value.category !== undefined) setJson(root, "category", value.category)
    if (value.answers !== undefined) writeEntries(asType(root.get("answers"), Y.Map<unknown>), Object.entries(value.answers))
    setJson(root, "schemaVersion", content.schemaVersion)
    setJson(root, "branding", content.branding)
    setJson(root, "layout", content.layout)

    const blocks = asType(root.get("blocks"), Y.Map<unknown>)
    writeOrder(asType(root.get("order"), Y.Array<string>), content.blocks.map((block) => block.id))

    for (const blockId of [...blocks.keys()]) {
      if (!content.blocks.some((block) => block.id === blockId)) blocks.delete(blockId)
    }

    for (const [index, block] of content.blocks.entries()) {
      const existing = blocks.get(block.id)

      if (existing instanceof Y.Map) {
        if (before.get(block.id) !== value.content.blocks[index]) writeBlock(existing, block)
      } else {
        const created = new Y.Map<unknown>()
        blocks.set(block.id, created)
        writeBlock(created, block)
      }
    }

    writeEntries(asType(root.get("sections"), Y.Map<unknown>), content.sections.map((section) => [section.id, section]))
    writeEntries(asType(root.get("fieldGroups"), Y.Map<unknown>), content.fieldGroups.map((group) => [group.id, group]))
    writeEntries(asType(root.get("blockRules"), Y.Map<unknown>), content.blockRules.map((rule) => [rule.blockId, rule]))
  }, options.origin)
}

function writeBlock(map: Y.Map<unknown>, block: TemplateBlock): void {
  const { itemRuns, items, runs, text, ...rest } = block as Record<string, unknown>
  const entries = new Map<string, unknown>(Object.entries(rest))

  if (LINE_TYPES.has(block.type)) {
    entries.set("text", toRuns(text as string, runs as TextRun[] | undefined))
  } else if (LIST_TYPES.has(block.type)) {
    entries.set("items", (items as string[]).map((item, index) => toRuns(item, (itemRuns as Array<TextRun[] | null> | undefined)?.[index] ?? undefined)))
  } else {
    for (const [key, value] of Object.entries({ itemRuns, items, runs, text })) {
      if (value !== undefined) entries.set(key, value)
    }
  }

  for (const key of [...map.keys()]) {
    if (!entries.has(key) || entries.get(key) === undefined) map.delete(key)
  }

  for (const [key, value] of entries) {
    if (value === undefined) continue

    if (key === "text" && LINE_TYPES.has(block.type)) {
      writeText(textAt(map, key), value as Run[])
    } else if (key === "items" && LIST_TYPES.has(block.type)) {
      writeList(listAt(map, key), value as Run[][])
    } else {
      setJson(map, key, value)
    }
  }
}

function readBlock(map: Y.Map<unknown>): TemplateBlock {
  const block: Record<string, unknown> = {}

  for (const [key, value] of map.entries()) {
    if (value instanceof Y.Text) {
      const { runs, text } = fromRuns(readRuns(value))
      block[key] = text
      if (runs) block.runs = runs
    } else if (value instanceof Y.Array) {
      const items = value.toArray().map((item) => fromRuns(readRuns(asType(item, Y.Text))))
      block[key] = items.map((item) => item.text)
      if (items.some((item) => item.runs)) block.itemRuns = items.map((item) => item.runs ?? null)
    } else if (value instanceof Y.AbstractType) {
      throw new TypeError("A block holds something a working copy cannot.")
    } else {
      block[key] = value
    }
  }

  return sortedObject(block) as TemplateBlock
}

/** Replaces only what changed between a text's runs and the runs it should have. */
function writeText(ytext: Y.Text, target: readonly Run[]): void {
  const current = readRuns(ytext)
  const before = current.map((run) => run.text).join("")
  const after = target.map((run) => run.text).join("")
  let prefix = 0
  let suffix = 0

  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  // Never between the two halves of one character.
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix -= 1
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1
  }
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix -= 1

  // Formatting first where the words did not change, then the words, then the formatting after them.
  formatChanges(current, target, 0, prefix, 0).forEach((change) => ytext.format(change.index, change.length, change.marks))
  if (before.length - prefix - suffix > 0) ytext.delete(prefix, before.length - prefix - suffix)

  let index = prefix
  for (const piece of slice(target, prefix, after.length - suffix)) {
    ytext.insert(index, piece.text, { ...piece.marks })
    index += piece.text.length
  }

  const shift = after.length - before.length
  formatChanges(current, target, before.length - suffix, before.length, shift).forEach((change) =>
    ytext.format(change.index, change.length, change.marks)
  )
}

function writeList(yarray: Y.Array<unknown>, target: readonly Run[][]): void {
  const current = yarray.toArray().map((item) => asType(item, Y.Text))
  const same = (index: number, targetIndex: number): boolean =>
    JSON.stringify(readRuns(current[index]!)) === JSON.stringify(target[targetIndex])
  let prefix = 0
  let suffix = 0

  while (prefix < current.length && prefix < target.length && same(prefix, prefix)) prefix += 1
  while (
    suffix < current.length - prefix &&
    suffix < target.length - prefix &&
    same(current.length - 1 - suffix, target.length - 1 - suffix)
  ) {
    suffix += 1
  }

  const changedBefore = current.length - prefix - suffix
  const changedAfter = target.length - prefix - suffix
  const kept = Math.min(changedBefore, changedAfter)

  for (let offset = 0; offset < kept; offset += 1) writeText(current[prefix + offset]!, target[prefix + offset]!)
  if (changedBefore > kept) yarray.delete(prefix + kept, changedBefore - kept)

  const added = target.slice(prefix + kept, prefix + changedAfter).map(() => new Y.Text())
  yarray.insert(prefix + kept, added)
  added.forEach((item, offset) => writeText(item, target[prefix + kept + offset]!))
}

/** Moves ids with the fewest removals and insertions, so a moved block keeps its place in everyone's edits. */
function writeOrder(yarray: Y.Array<string>, target: readonly string[]): void {
  const current = yarray.toArray()

  if (current.length === target.length && current.every((blockId, index) => blockId === target[index])) {
    return
  }

  const lengths = Array.from({ length: current.length + 1 }, () => new Array<number>(target.length + 1).fill(0))

  for (let i = current.length - 1; i >= 0; i -= 1) {
    for (let j = target.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = current[i] === target[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
    }
  }

  let i = 0
  let j = 0
  let index = 0

  while (i < current.length || j < target.length) {
    if (i < current.length && j < target.length && current[i] === target[j]) {
      i += 1
      j += 1
      index += 1
    } else if (j < target.length && (i === current.length || lengths[i]![j + 1]! >= lengths[i + 1]![j]!)) {
      yarray.insert(index, [target[j]!])
      j += 1
      index += 1
    } else {
      yarray.delete(index, 1)
      i += 1
    }
  }
}

function writeEntries(map: Y.Map<unknown>, entries: ReadonlyArray<readonly [string, unknown]>): void {
  const keys = new Set(entries.map(([key]) => key))

  for (const key of [...map.keys()]) {
    if (!keys.has(key)) map.delete(key)
  }

  for (const [key, value] of entries) setJson(map, key, value)
}

function setJson(map: Y.Map<unknown>, key: string, value: unknown): void {
  const current = map.get(key)

  if (current instanceof Y.AbstractType || JSON.stringify(current) !== JSON.stringify(value)) {
    map.set(key, value)
  }
}

function textAt(map: Y.Map<unknown>, key: string): Y.Text {
  const current = map.get(key)
  if (current instanceof Y.Text) return current
  const created = new Y.Text()
  map.set(key, created)
  return created
}

function listAt(map: Y.Map<unknown>, key: string): Y.Array<unknown> {
  const current = map.get(key)
  if (current instanceof Y.Array) return current
  const created = new Y.Array<unknown>()
  map.set(key, created)
  return created
}

function toRuns(text: string, runs: readonly TextRun[] | null | undefined): Run[] {
  const fitted = fitRuns(text, runs)
  const pieces = fitted ?? (text ? [{ text }] : [])

  return pieces.map(({ text: words, ...marks }) => ({ marks: sortedObject(marks), text: words }))
}

function fromRuns(runs: readonly Run[]): { runs?: TextRun[]; text: string } {
  const text = runs.map((run) => run.text).join("")
  const fitted = fitRuns(text, runs.map((run) => ({ ...run.marks, text: run.text }) as TextRun))

  return fitted ? { runs: fitted, text } : { text }
}

function readRuns(ytext: Y.Text): Run[] {
  return (ytext.toDelta() as Array<{ attributes?: Marks; insert: unknown }>).flatMap((op) =>
    typeof op.insert === "string" ? [{ marks: sortedObject(op.attributes ?? {}), text: op.insert }] : []
  )
}

// The pieces of runs between two points, keeping each piece's formatting.
function slice(runs: readonly Run[], start: number, end: number): Run[] {
  const pieces: Run[] = []
  let at = 0

  for (const run of runs) {
    const from = Math.max(start, at)
    const to = Math.min(end, at + run.text.length)
    if (from < to) pieces.push({ marks: run.marks, text: run.text.slice(from - at, to - at) })
    at += run.text.length
  }

  return pieces
}

// Where the same words need different formatting: each stretch, in the new text's positions.
function formatChanges(
  current: readonly Run[],
  target: readonly Run[],
  start: number,
  end: number,
  shift: number
): Array<{ index: number; length: number; marks: Marks }> {
  const changes: Array<{ index: number; length: number; marks: Marks }> = []
  const breaks = new Set<number>([start, end])
  let at = 0

  for (const run of current) {
    at += run.text.length
    if (at > start && at < end) breaks.add(at)
  }
  at = 0
  for (const run of target) {
    at += run.text.length
    if (at - shift > start && at - shift < end) breaks.add(at - shift)
  }

  const points = [...breaks].sort((left, right) => left - right)

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    const was = slice(current, from, from + 1)[0]?.marks ?? {}
    const becomes = slice(target, from + shift, from + shift + 1)[0]?.marks ?? {}
    const marks: Marks = {}

    for (const key of new Set([...Object.keys(was), ...Object.keys(becomes)])) {
      if (JSON.stringify(was[key]) !== JSON.stringify(becomes[key])) marks[key] = becomes[key] ?? null
    }

    if (Object.keys(marks).length > 0) changes.push({ index: from + shift, length: to - from, marks })
  }

  return changes
}

function asType<Type>(value: unknown, type: abstract new (...args: never[]) => Type): Type {
  if (value instanceof type) return value
  throw new TypeError("The shared document is not shaped like a working copy.")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sortedObject<Value extends Record<string, unknown>>(value: Value): Value {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) as Value
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
