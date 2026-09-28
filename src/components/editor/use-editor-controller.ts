"use client"

import type { Editor } from "@tiptap/core"
import { useState } from "react"

import type { InsertChoice } from "@/components/editor/block-catalog"
import {
  type CaretTarget,
  convertTextBlock,
  hasPageBreak,
  insertPageAfter,
  insertSectionAfter,
  removePageBreak,
  sectionOfTitle,
  sectionTitleKey,
  type TextBlockKind,
  turnLineIntoSection,
  turnSectionIntoLine,
} from "@/components/editor/editor-content"
import { createTemplateBlock } from "@/components/templates/template-editor-state"
import { bizflowToast } from "@/components/ui/toaster"
import {
  MAX_TEMPLATE_BLOCK_COUNT,
  type TemplateBlock,
  type TemplateContentV3,
  type TemplateLayout,
  type TemplateSection,
} from "@/types/template"
import {
  deleteTemplateBlock,
  duplicateTemplateBlock,
  evaluateTemplateBlockDeletion,
  insertTemplateBlock,
  getTemplateSectionForBlock,
  moveTemplateBlockTo,
  moveTemplateSection,
  removeTemplateSection,
  setBlockKeepWithNext,
  setFieldSideBySide,
  stepTemplateBlockSlot,
  type TemplateBlockSlot,
  type TemplateMoveResult,
  updateTemplateBlock,
  updateTemplateFieldGroup,
  updateTemplateSection,
} from "@/types/template-structure"

/** A caret the canvas should place, with a nonce so the same spot can be asked for twice. */
export type FocusRequest = CaretTarget & Readonly<{ nonce: number }>

/** Every change the canvas, dock and panels can make to one page of content. */
export type EditorController = ReturnType<typeof useEditorController>

// Blocks that cannot be used until they are set up open their settings at once.
const NEEDS_SETUP: ReadonlySet<TemplateBlock["type"]> = new Set(["dropdown_field", "image"])

/**
 * Turns choices into content changes and keeps what is selected, where the
 * caret is, and which block's settings are open. Structural edits go through
 * the template-structure helpers, so sections, groups, page breaks and field
 * conditions stay consistent.
 *
 * @param options - The content, how to change it, and how to undo.
 * @returns The controller shared by the canvas, dock, and panels.
 */
export function useEditorController({
  change,
  content,
  undo,
}: {
  change: (update: (content: TemplateContentV3) => TemplateContentV3, coalesceKey?: string) => void
  content: TemplateContentV3
  undo: () => void
}) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [settingsBlockId, setSettingsBlockId] = useState<string | null>(null)
  // The line the caret was last in: what the toolbar formats.
  const [line, setLine] = useState<Editor | null>(null)
  // What a screen reader says after a move.
  const [announcement, setAnnouncement] = useState("")

  function requestFocus(target: CaretTarget): void {
    setSelectedBlockId(null)
    setActiveBlockId(target.blockId)
    setFocus({ ...target, nonce: Date.now() + Math.random() })
  }

  function select(blockId: string | null): void {
    setSelectedBlockId(blockId)

    if (blockId) {
      setActiveBlockId(blockId)
      setLine((current) => {
        const lineBlockId = current?.view.dom.dataset.caretKey?.split(":")[0]
        return lineBlockId === blockId ? current : null
      })
    }
  }

  function hasRoom(): boolean {
    if (content.blocks.length < MAX_TEMPLATE_BLOCK_COUNT) {
      return true
    }

    bizflowToast.info(`A page can hold up to ${MAX_TEMPLATE_BLOCK_COUNT} blocks.`)
    return false
  }

  /**
   * Adds a choice after the block in use, or in place of an empty line.
   *
   * @param choice - What to add.
   * @param options - Where: after a block, or replacing an empty line; and a table's size.
   */
  function insert(
    choice: InsertChoice,
    options: {
      afterBlockId?: string | null
      replaceBlockId?: string
      table?: Readonly<{ columns: number; rows: number }>
    } = {}
  ): void {
    const replaceBlockId = options.replaceBlockId
    // With the caret in a section's title, what is added goes just under it.
    const titled = content.sections.find((section) => section.id === sectionOfTitle(activeBlockId))
    const titledIndex = content.blocks.findIndex((block) => block.id === titled?.startBlockId)
    const afterBlockId =
      options.afterBlockId !== undefined
        ? options.afterBlockId
        : titled
          ? (content.blocks[titledIndex - 1]?.id ?? null)
          : (activeBlockId ?? content.blocks.at(-1)?.id ?? null)
    const underTitle = (current: TemplateContentV3, blockId: string): TemplateContentV3 =>
      titled && options.afterBlockId === undefined
        ? { ...current, sections: current.sections.map((section) => (section.id === titled.id ? { ...section, startBlockId: blockId } : section)) }
        : current

    if (choice.action.kind === "section") {
      if (!replaceBlockId && !hasRoom()) return
      const sectionId = crypto.randomUUID()

      change((current) =>
        replaceBlockId
          ? turnLineIntoSection(current, replaceBlockId, sectionId).content
          : insertSectionAfter(current, afterBlockId, sectionId, crypto.randomUUID()).content
      )
      requestFocus({ blockId: sectionTitleKey(sectionId), offset: 0 })
      return
    }

    if (choice.action.kind === "page") {
      if (replaceBlockId) {
        change((current) => addPageBreak(current, replaceBlockId))
        requestFocus({ blockId: replaceBlockId, offset: 0 })
        return
      }

      addPage(afterBlockId)
      return
    }

    if (choice.action.kind === "text") {
      if (replaceBlockId) {
        const kind = choice.action.value
        const isList = kind.type === "bullet_list" || kind.type === "numbered_list"

        change((current) => convertTextBlock(current, replaceBlockId, kind, { text: "" }).content)
        requestFocus({ blockId: replaceBlockId, item: isList ? 0 : undefined, offset: 0 })
        return
      }

      if (!hasRoom()) {
        return
      }

      const block = createTextBlock(crypto.randomUUID(), choice.action.value)
      change((current) => underTitle(insertTemplateBlock(current, afterBlockId, block), block.id))
      requestFocus({ blockId: block.id, item: "items" in block ? 0 : undefined, offset: 0 })
      return
    }

    if (!hasRoom()) {
      return
    }

    const created = createTemplateBlock(choice.action.type, content.blocks)
    const size = options.table
    // A table picked from the size grid has that many columns, and rows counting its heading row.
    const block: TemplateBlock =
      created.type === "table" && size
        ? {
            ...created,
            headers: Array.from({ length: size.columns }, (_, index) => `Column ${index + 1}`),
            rows: Array.from({ length: size.rows - 1 }, () => Array.from({ length: size.columns }, () => "")),
          }
        : created

    change((current) => {
      if (!replaceBlockId) {
        return underTitle(insertTemplateBlock(current, afterBlockId, block), block.id)
      }

      // The empty line gives way to the block, which keeps any page break.
      const placed = insertTemplateBlock(current, replaceBlockId, block)
      const moved = hasPageBreak(current, replaceBlockId) ? addPageBreak(placed, block.id) : placed

      return deleteTemplateBlock(moved, replaceBlockId)
    })
    setFocus(null)
    select(block.id)

    if (NEEDS_SETUP.has(block.type)) {
      setSettingsBlockId(block.id)
    }
  }

  /**
   * Adds an empty page after a block. When the block is not the last, what
   * follows it also starts on its own page, so the new page sits between.
   *
   * @param afterBlockId - The last block before the new page, or null.
   */
  function addPage(afterBlockId: string | null): void {
    if (!hasRoom()) {
      return
    }

    const id = crypto.randomUUID()

    change((current) => {
      const index = afterBlockId === null ? -1 : current.blocks.findIndex((block) => block.id === afterBlockId)
      const following = current.blocks[index + 1]
      const added = insertPageAfter(current, afterBlockId, id)

      return following ? addPageBreak(added, following.id) : added
    })
    requestFocus({ blockId: id, offset: 0 })
  }

  function duplicate(blockId: string): void {
    if (!hasRoom()) {
      return
    }

    const id = crypto.randomUUID()
    change((current) => duplicateTemplateBlock(current, blockId, id))
    select(id)
  }

  /**
   * Moves a block to a place, leaving everything else where it is, and says
   * where it went; a move that would put a conditional field above the field
   * it depends on is refused with the reason.
   *
   * @param blockId - The block.
   * @param slot - Where to.
   * @returns Whether it moved.
   */
  function moveTo(blockId: string, slot: TemplateBlockSlot): boolean {
    const result = moveTemplateBlockTo(content, blockId, slot, crypto.randomUUID())

    if (!applyMove(result) || !result.success) {
      return false
    }

    setAnnouncement(describeMove(result.content, blockId))
    return true
  }

  // One step up or down: past a row as one piece, and past a section's title.
  function move(blockId: string, direction: "up" | "down"): void {
    const slot = stepTemplateBlockSlot(content, blockId, direction)

    if (slot) {
      moveTo(blockId, slot)
    }
  }

  /**
   * Moves a section, with all it holds, above or below its neighbour.
   *
   * @param sectionId - The section.
   * @param direction - Which way.
   */
  function moveSection(sectionId: string, direction: "up" | "down"): void {
    const label = content.sections.find((section) => section.id === sectionId)?.label ?? "Section"

    if (applyMove(moveTemplateSection(content, sectionId, direction))) {
      setAnnouncement(`${label} moved ${direction}.`)
    }
  }

  function applyMove(result: TemplateMoveResult): boolean {
    if (!result.success) {
      bizflowToast.error(result.message)
      return false
    }

    // A section a move empties keeps a line, which a full page has no room for.
    if (result.content === content || (result.content.blocks.length > content.blocks.length && !hasRoom())) {
      return false
    }

    change(() => result.content)
    return true
  }

  function remove(blockId: string): void {
    const evaluation = evaluateTemplateBlockDeletion(content.blocks, blockId)

    if (!evaluation.success) {
      bizflowToast.error(evaluation.message)
      return
    }

    const index = content.blocks.findIndex((block) => block.id === blockId)
    const previous = content.blocks[index - 1]

    change((current) => deleteTemplateBlock(current, blockId))
    setSelectedBlockId(null)
    setSettingsBlockId((open) => (open === blockId ? null : open))
    bizflowToast.info("Deleted", { action: { label: "Undo", onClick: undo } })

    if (previous && (previous.type === "paragraph" || previous.type === "heading")) {
      requestFocus({ blockId: previous.id, offset: previous.text.length })
    }
  }

  function updateBlock(block: TemplateBlock, coalesceKey?: string): void {
    change((current) => updateTemplateBlock(current, block), coalesceKey)
  }

  /**
   * Changes a section's title or page rules; typing the title makes one undo step.
   *
   * @param sectionId - The section.
   * @param patch - Its new title or rules.
   * @param coalesceKey - Joins a run of keystrokes into one undo step.
   */
  function updateSection(
    sectionId: string,
    patch: Partial<Pick<TemplateSection, "keepTogether" | "label" | "pageBreakBefore">>,
    coalesceKey?: string
  ): void {
    change((current) => updateTemplateSection(current, sectionId, patch), coalesceKey)
  }

  /**
   * Takes a section's title and boundary away, keeping what it held, and puts
   * the caret at the start of its first line.
   *
   * @param sectionId - The section.
   */
  function removeSection(sectionId: string): void {
    const start = content.blocks.find((block) => block.id === content.sections.find((section) => section.id === sectionId)?.startBlockId)

    change((current) => removeTemplateSection(current, sectionId))

    if (start && (start.type === "paragraph" || start.type === "heading")) {
      requestFocus({ blockId: start.id, offset: 0 })
    }
  }

  /**
   * Turns a line into the title of a section holding what follows it.
   *
   * @param blockId - The line.
   */
  function turnIntoSection(blockId: string): void {
    const sectionId = crypto.randomUUID()
    const result = turnLineIntoSection(content, blockId, sectionId)
    change(() => result.content)
    requestFocus(result.focus)
  }

  /**
   * Turns a section's title back into a line where it stands.
   *
   * @param sectionId - The section.
   * @param kind - The kind of line the title becomes.
   */
  function turnSectionInto(sectionId: string, kind: TextBlockKind): void {
    const id = crypto.randomUUID()
    const label = content.sections.find((section) => section.id === sectionId)?.label ?? ""

    change((current) => turnSectionIntoLine(current, sectionId, kind, id).content)
    requestFocus({ blockId: id, offset: label.length })
  }

  // A drag or a run of keystrokes on one setting makes one undo step.
  function setLayout(layout: TemplateLayout, coalesceKey?: string): void {
    change((current) => ({ ...current, layout }), coalesceKey)
  }

  return {
    activeBlockId,
    addPage,
    announcement,
    /** Whether a block has somewhere to go, one step up or down. */
    canMove: (blockId: string, direction: "up" | "down") => stepTemplateBlockSlot(content, blockId, direction) !== null,
    change,
    /** The section the caret is in, or its title's section, or null before any. */
    currentSectionId: sectionOfTitle(activeBlockId) ?? (activeBlockId ? getTemplateSectionForBlock(content, activeBlockId)?.id ?? null : null),
    closeSettings: () => setSettingsBlockId(null),
    content,
    duplicate,
    focus,
    insert,
    line,
    move,
    moveSection,
    moveTo,
    openSettings: setSettingsBlockId,
    remove,
    removeSection,
    requestFocus,
    select,
    selectedBlockId,
    setActiveBlockId,
    setKeepWithNext: (blockId: string, keep: boolean) => change((current) => setBlockKeepWithNext(current, blockId, keep)),
    setLayout,
    setLine,
    setSideBySide: (blockId: string, sideBySide: boolean) =>
      change((current) => setFieldSideBySide(current, blockId, sideBySide, crypto.randomUUID())),
    settingsBlockId,
    turnIntoSection,
    turnSectionInto,
    updateBlock,
    // Typing a group's label makes one undo step.
    updateGroup: (groupId: string, patch: Readonly<{ keepTogether?: boolean; label?: string }>, coalesceKey?: string) =>
      change((current) => updateTemplateFieldGroup(current, groupId, patch), coalesceKey),
    updateSection,
  }
}

/**
 * Starts a block's page break, keeping a rule it already has.
 *
 * @param content - The page.
 * @param blockId - The block that should start a page.
 * @returns The content with the break.
 */
export function addPageBreak(content: TemplateContentV3, blockId: string): TemplateContentV3 {
  if (hasPageBreak(content, blockId)) {
    return content
  }

  const cleared = removePageBreak(content, blockId)
  const rule = cleared.blockRules.find((candidate) => candidate.blockId === blockId)

  return {
    ...cleared,
    blockRules: rule
      ? cleared.blockRules.map((candidate) =>
          candidate.blockId === blockId ? { ...candidate, pageBreakBefore: true } : candidate
        )
      : [...cleared.blockRules, { blockId, keepWithNext: false, pageBreakBefore: true }],
  }
}

function createTextBlock(id: string, kind: TextBlockKind): TemplateBlock {
  switch (kind.type) {
    case "heading":
      return { alignment: "left", id, level: kind.level, text: "", type: "heading" }
    case "paragraph":
      return { alignment: "left", id, text: "", type: "paragraph" }
    default:
      return { id, items: [""], type: kind.type }
  }
}

// Where a block now is, as a screen reader should hear it.
function describeMove(content: TemplateContentV3, blockId: string): string {
  const index = content.blocks.findIndex((block) => block.id === blockId)
  const block = content.blocks[index]
  const section = getTemplateSectionForBlock(content, blockId)
  const name =
    block && "label" in block
      ? block.label
      : block && "text" in block && block.text.trim()
        ? `“${block.text.trim().split(/\s+/).slice(0, 6).join(" ")}”`
        : "Block"

  return `${name} moved to ${index + 1} of ${content.blocks.length}${section ? `, in ${section.label}` : ""}.`
}
