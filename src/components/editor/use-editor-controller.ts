"use client"

import { useState } from "react"

import type { InsertChoice } from "@/components/editor/block-catalog"
import {
  type CaretTarget,
  convertTextBlock,
  hasPageBreak,
  insertPageAfter,
  removePageBreak,
  type TextBlockKind,
} from "@/components/editor/editor-content"
import { createTemplateBlock } from "@/components/templates/template-editor-state"
import { bizflowToast } from "@/components/ui/toaster"
import {
  MAX_TEMPLATE_BLOCK_COUNT,
  type TemplateBlock,
  type TemplateContentV3,
  type TemplateLayout,
} from "@/types/template"
import {
  deleteTemplateBlock,
  duplicateTemplateBlock,
  evaluateTemplateBlockDeletion,
  evaluateTemplateBlockMove,
  insertTemplateBlock,
  moveTemplateBlock,
  updateTemplateBlock,
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

  function requestFocus(target: CaretTarget): void {
    setSelectedBlockId(null)
    setActiveBlockId(target.blockId)
    setFocus({ ...target, nonce: Date.now() + Math.random() })
  }

  function select(blockId: string | null): void {
    setSelectedBlockId(blockId)

    if (blockId) {
      setActiveBlockId(blockId)
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
   * @param options - Where: after a block, or replacing an empty line.
   */
  function insert(
    choice: InsertChoice,
    options: { afterBlockId?: string | null; replaceBlockId?: string } = {}
  ): void {
    const replaceBlockId = options.replaceBlockId
    const afterBlockId =
      options.afterBlockId !== undefined
        ? options.afterBlockId
        : (activeBlockId ?? content.blocks.at(-1)?.id ?? null)

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

        change((current) => convertTextBlock(current, replaceBlockId, kind, "").content)
        requestFocus({ blockId: replaceBlockId, item: isList ? 0 : undefined, offset: 0 })
        return
      }

      if (!hasRoom()) {
        return
      }

      const block = createTextBlock(crypto.randomUUID(), choice.action.value)
      change((current) => insertTemplateBlock(current, afterBlockId, block))
      requestFocus({ blockId: block.id, item: "items" in block ? 0 : undefined, offset: 0 })
      return
    }

    if (!hasRoom()) {
      return
    }

    const block = createTemplateBlock(choice.action.type, content.blocks)

    change((current) => {
      if (!replaceBlockId) {
        return insertTemplateBlock(current, afterBlockId, block)
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

  function move(blockId: string, direction: "up" | "down"): void {
    const evaluation = evaluateTemplateBlockMove(content.blocks, blockId, direction)

    if (!evaluation.success) {
      bizflowToast.error(evaluation.message)
      return
    }

    change((current) => moveTemplateBlock(current, blockId, direction))
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

  function setLayout(layout: TemplateLayout): void {
    change((current) => ({ ...current, layout }))
  }

  return {
    activeBlockId,
    addPage,
    change,
    closeSettings: () => setSettingsBlockId(null),
    content,
    duplicate,
    focus,
    insert,
    move,
    openSettings: setSettingsBlockId,
    remove,
    requestFocus,
    select,
    selectedBlockId,
    setActiveBlockId,
    setLayout,
    settingsBlockId,
    updateBlock,
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
