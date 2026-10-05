"use client"

// What lets the canvas be designed: typing that splits, joins and turns lines
// into lists, the slash menu, dragging blocks to new places, selecting across
// blocks, and a lone block's edges. The editors hand it over (see
// design-tools); a page that only shows or fills a document never loads it.

import { type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode, type RefObject, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { findInsertChoices, INSERT_CHOICES, type InsertChoice } from "@/components/editor/block-catalog"
import { designTools } from "@/components/editor/design-tools"
import type { TextCaret } from "@/components/editor/editable-text"
import { type CanvasActions, isLine, isList, type LineBlock, type ListBlock } from "@/components/editor/editor-block"
import {
  convertTextBlock,
  deleteAcross,
  insertLines,
  joinRuns,
  liftListItem,
  type ListEntry,
  listEntries,
  mergeIntoPrevious,
  readMarkdownShortcut,
  sliceRuns,
  sectionTitleKey,
  splitTextBlock,
  withEntries,
} from "@/components/editor/editor-content"
import type { CanvasUnit, paginate } from "@/components/editor/editor-pagination"
import { SNAP_PX, snapBox } from "@/components/editor/image-placement"
import { usePageSelection } from "@/components/editor/page-selection"
import { type DragBox, type DragLine, type DropTarget, useBlockDrag } from "@/components/editor/use-block-drag"
import { addPageBreak, type EditorController } from "@/components/editor/use-editor-controller"
import { bizflowToast } from "@/components/ui/toaster"
import { cn } from "@/lib/utils"
import type { BlockFrame, TemplateContentV3, TextRun } from "@/types/template"
import {
  frameOf,
  getTemplateBlockSlot,
  listTemplateBlockSlots,
  moveTemplateBlockTo,
  placeBeside,
  rowOf,
  setBlockRule,
  type TemplateBlockSlot,
  updateTemplateBlock,
} from "@/types/template-structure"

const TEXT_CHOICE = INSERT_CHOICES[0] as InsertChoice

/** Where a dragged block lands: in a gap between blocks, or beside one, in its row. */
type CanvasDrop =
  | Readonly<{ kind: "gap"; slot: TemplateBlockSlot }>
  | Readonly<{ frame: BlockFrame | null; kind: "free"; slot: TemplateBlockSlot | null; spaceAbove: number }>
  | Readonly<{ kind: "beside"; side: "left" | "right"; targetId: string }>

type SlashState = Readonly<{
  active: number
  anchor: DOMRect
  blockId: string
  query: string
  start: number
}>

/** What the canvas measures and holds that designing works from. */
export type CanvasEditingInput = Readonly<{
  allowFiles: boolean
  content: TemplateContentV3
  controller: EditorController
  layout: ReturnType<typeof paginate>
  narrow: boolean
  /** CSS pixels in a printed point, at 100%. */
  point: number
  rootRef: RefObject<HTMLDivElement | null>
  textEditable: boolean
  unitElements: RefObject<Map<string, HTMLElement>>
  unitOf: ReadonlyMap<string, string>
  units: readonly CanvasUnit[]
  zoom: number
}>

/** What designing adds to the canvas: its blocks' typing and dragging, and what it draws over the page. */
export type CanvasEditing = Readonly<{
  actions: Pick<CanvasActions, "onLineInput" | "onLineKeyDown" | "onListInput" | "onListKeyDown" | "onPasteLines" | "placeholderFor" | "startDrag">
  dragging: string | null
  /** Puts the caret at the end of a page's writing, as a click on its empty paper does. */
  focusPageEnd: (page: number) => void
  /** The slash menu, and the line and guides a dragged block lands by. */
  overlays: ReactNode
}>

/**
 * Typing, the slash menu, dragging and selecting, for a canvas that is designed.
 *
 * @param input - What the canvas measures and holds.
 * @returns The blocks' handlers, what is being dragged, and what is drawn over the page.
 */
export function useCanvasEditing({
  allowFiles,
  content,
  controller,
  layout,
  narrow,
  point,
  rootRef,
  textEditable,
  unitElements,
  unitOf,
  units,
  zoom,
}: CanvasEditingInput): CanvasEditing {
  const SlashMenu = designTools()?.SlashMenu
  const [slash, setSlash] = useState<SlashState | null>(null)
  const { begin, dragging, guides, indicator } = useBlockDrag<CanvasDrop>({ lift: !narrow, locate, onDrop: drop, zoom: narrow ? 1 : zoom })
  const slashChoices = useMemo(
    () => (slash ? findInsertChoices({ allowFiles, query: slash.query }) : []),
    [allowFiles, slash]
  )

  function updateSlash(blockId: string, text: string, caret: number): void {
    if (text[caret - 1] === "/" && (caret === 1 || /\s/.test(text[caret - 2] ?? ""))) {
      setSlash({ active: 0, anchor: readCaretRect(), blockId, query: "", start: caret - 1 })
      return
    }

    setSlash((open) => {
      if (!open || open.blockId !== blockId) {
        return open
      }

      const query = text.slice(open.start + 1, caret)

      return caret <= open.start || text[open.start] !== "/" || /\s/.test(query) || query.length > 24
        ? null
        : { ...open, active: 0, query }
    })
  }

  function chooseSlash(choice: InsertChoice): void {
    const open = slash
    const block = content.blocks.find((candidate) => candidate.id === open?.blockId)

    setSlash(null)

    if (!open || !isLine(block)) {
      return
    }

    // The typed / and its query go; the words around them stay as they were.
    const end = open.start + 1 + open.query.length
    const rest: ListEntry = {
      runs: joinRuns(
        { runs: sliceRuns(block.runs, 0, open.start), text: block.text.slice(0, open.start) },
        { runs: sliceRuns(block.runs, end), text: block.text.slice(end) }
      ),
      text: block.text.slice(0, open.start) + block.text.slice(end),
    }

    if (choice.action.kind === "text") {
      const kind = choice.action.value
      const list = kind.type === "bullet_list" || kind.type === "numbered_list"

      controller.change((current) => convertTextBlock(current, block.id, kind, rest).content)
      controller.requestFocus({ blockId: block.id, item: list ? 0 : undefined, offset: open.start })
      return
    }

    controller.updateBlock({ ...block, ...rest })
    controller.insert(
      choice,
      rest.text.trim().length === 0 ? { replaceBlockId: block.id } : { afterBlockId: block.id }
    )
  }

  function focusNeighbour(blockId: string, direction: -1 | 1): boolean {
    const blocks = content.blocks
    const section = direction < 0 ? content.sections.find((section) => section.startBlockId === blockId) : content.sections.find((section) => section.startBlockId === blocks[blocks.findIndex((block) => block.id === blockId) + 1]?.id)
    if (section) {
      controller.requestFocus({ blockId: sectionTitleKey(section.id), offset: direction < 0 ? section.label.length : 0 })
      return true
    }
    let index = blocks.findIndex((candidate) => candidate.id === blockId) + direction

    while (blocks[index] && !isLine(blocks[index]) && !isList(blocks[index])) {
      index += direction
    }

    const neighbour = blocks[index]

    if (isLine(neighbour)) {
      controller.requestFocus({ blockId: neighbour.id, offset: direction < 0 ? neighbour.text.length : 0 })
      return true
    }

    if (isList(neighbour)) {
      const item = direction < 0 ? neighbour.items.length - 1 : 0
      controller.requestFocus({
        blockId: neighbour.id,
        item,
        offset: direction < 0 ? (neighbour.items[item]?.length ?? 0) : 0,
      })
      return true
    }

    return false
  }

  function handleSlashKey(event: globalThis.KeyboardEvent, blockId: string): boolean {
    if (!slash || slash.blockId !== blockId) {
      return false
    }

    const count = Math.max(1, slashChoices.length)

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setSlash({ ...slash, active: (slash.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count })
      return true
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      const choice = slashChoices[slash.active]

      if (choice) {
        chooseSlash(choice)
      } else {
        setSlash(null)
      }

      return true
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setSlash(null)
      return true
    }

    return false
  }

  // Where a dragged block lands: beside a block whose left or right quarter
  // the pointer is over, joining it in a row, or else the gap nearest the
  // pointer's height.
  // On paper the block goes where it is let go, lined up with what it comes
  // near; a phone's column only has places between blocks.
  function locate(blockId: string, x: number, y: number, box: DragBox): DropTarget<CanvasDrop> | null {
    // On paper the block's own middle decides, wherever it was grabbed.
    const middle = narrow ? { x, y } : { x: box.left + box.width / 2, y: box.top + box.height / 2 }

    return locateBeside(blockId, middle.x, middle.y, box) ?? (narrow ? locateGap(blockId, y) : locateFree(blockId, box))
  }

  // Where a block let go on the page lands: after the last line that starts
  // above it, as far below it as it was let go, and across the page where it
  // was let go. It lines up with the margins, the page's middle and other
  // blocks' edges and middles, sits snug under the line above when near it,
  // and takes the same space as another block when near that.
  function locateFree(blockId: string, box: DragBox): DropTarget<CanvasDrop> | null {
    const screenPoint = point * zoom
    const own = unitOf.get(blockId)
    const ownUnit = units.find((unit) => unit.id === own)
    const lines = units.flatMap((unit) => {
      const element = unitElements.current.get(unit.id)
      // A block alone on its line has left it while it moves.
      const gone = unit.id === own && unit.blocks.length === 1

      return element && !gone ? [{ rect: element.getBoundingClientRect(), unit }] : []
    })
    const page = lines[0]?.rect
    const dragged = rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)

    if (!page || !dragged || !ownUnit) {
      return null
    }

    // It goes past a block once its top passes that block's middle, so a gap
    // can open above it without the block below, closed up, taking its place.
    const above = lines.filter(({ rect }) => rect.top + rect.height / 2 <= box.top).at(-1) ?? lines[0]!
    const rest = content.blocks.filter((block) => block.id !== blockId)
    const lastAbove = above.unit.blocks.at(-1)?.block.id
    const gap = lastAbove === undefined ? 0 : rest.findIndex((block) => block.id === lastAbove) + 1
    const slots = listTemplateBlockSlots(content, blockId, false)
    const slot = slots.find((candidate) => candidate.index >= gap && candidate.opens === null) ?? slots.at(-1) ?? null
    const current = getTemplateBlockSlot(content, blockId)
    const same = slot && current && slot.index === current.index && slot.opens === current.opens && !current.inGroup

    // Snug under the line above: its own space above, as it prints.
    const lead = parseFloat(dragged.dataset.lead ?? "0") * zoom
    const snug = above.rect.bottom + lead
    const spaces = [0, ...new Set(units.flatMap((unit) => (unit.id !== own && unit.space ? [unit.space] : [])))]
    const asked = Math.max(0, (box.top - snug) / screenPoint)
    const even = spaces.find((space) => Math.abs(space - asked) * screenPoint <= SNAP_PX)
    const spaceAbove = even ?? Math.min(600, Math.round(asked))
    const top = snug + spaceAbove * screenPoint

    // Across: the margins, the middle, and the blocks on the page.
    const width = Math.min(box.width, page.width)
    const others = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? [])]
      .filter((element) => element !== dragged && element.dataset.blockId !== undefined)
      .map((element) => element.getBoundingClientRect())
    const sides = (rect: DOMRect): number[] => [rect.left - page.left, (rect.left + rect.right) / 2 - page.left, rect.right - page.left]
    const edges = [0, page.width / 2, page.width, ...others.flatMap(sides)]
    const across = snapBox({ height: box.height, width, x: box.left - page.left, y: 0 }, { x: edges, y: [] }, SNAP_PX, "move")
    const left = Math.min(Math.max(0, across.box.x), page.width - width)
    const frame = frameOf((left / page.width) * 100, (width / page.width) * 100) ?? null
    const guides: DragLine[] = []
    const lined = across.guides.x

    if (lined !== undefined) {
      // The line runs on to the nearest block it lines up with, so what it met shows.
      const met = others
        .filter((rect) => sides(rect).some((side) => Math.abs(side - lined) < 1))
        .sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top))[0]
      const from = Math.min(top - 24, met?.top ?? Infinity)
      const to = Math.max(top + box.height + 24, met?.bottom ?? -Infinity)

      guides.push({ height: to - from, left: page.left + lined, top: from, width: 1 })
    }

    if (even === 0) {
      guides.push({ height: 1, left: page.left + left, top, width })
    } else if (even !== undefined) {
      // The same gap, measured here and wherever else the page has it.
      const middle = page.left + left + width / 2
      const matched = units.flatMap((unit) => {
        const rect = unit.id !== own && unit.space === even ? unitElements.current.get(unit.id)?.getBoundingClientRect() : undefined
        const block = rect && unitElements.current.get(unit.id)?.querySelector("[data-block-id]")?.getBoundingClientRect()

        return rect && block ? [measure((block.left + block.right) / 2, rect.top, even * screenPoint)] : []
      })

      guides.push(...measure(middle, top - even * screenPoint, even * screenPoint), ...matched.flat())
    }

    return {
      at: { left: page.left + left, top },
      guides,
      slot: { frame, kind: "free", slot: same ? null : slot, spaceAbove },
      valid: true,
    }
  }

  // Rows stack on a phone, so there a block only goes above or below. On
  // paper it joins a block in a row when it comes to one's left or right
  // quarter, or to the empty page beside a block that does not fill its line.
  function locateBeside(blockId: string, x: number, y: number, held: DragBox): DropTarget<CanvasDrop> | null {
    if (narrow) {
      return null
    }

    const page = unitElements.current.values().next().value?.getBoundingClientRect()

    for (const element of rootRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []) {
      const targetId = element.dataset.blockId
      const box = element.getBoundingClientRect()
      const reach = { left: box.left - (page ? box.left - page.left : 0), right: page ? page.right : box.right }

      if (!targetId || targetId === blockId || x < reach.left || x > reach.right || y < box.top || y > box.bottom) {
        continue
      }

      // Laid over a block's middle, a block is on it, not beside it.
      if (held.left < box.left + box.width / 2 && held.left + held.width > box.left + box.width / 2) {
        return null
      }

      const edge = box.width / 4
      const side = x < box.left + edge ? "left" : x > box.right - edge ? "right" : null

      return side
        ? {
            line: { height: box.height, left: side === "left" ? box.left - 6 : box.right + 4, top: box.top + box.height / 2, width: 2 },
            slot: { kind: "beside", side, targetId },
            valid: placeBeside(content, blockId, targetId, side, () => blockId).success,
          }
        : null
    }

    return null
  }

  // The gap nearest the pointer's height, with a place above and below each
  // section's title, and nowhere while the pointer is over the block's own place.
  function locateGap(blockId: string, y: number): DropTarget<CanvasDrop> | null {
    const box = (id: string | undefined): DOMRect | undefined =>
      id === undefined ? undefined : unitElements.current.get(unitOf.get(id) ?? "")?.getBoundingClientRect()
    const own = box(blockId)
    const current = getTemplateBlockSlot(content, blockId)

    if (!own || !current || (y >= own.top && y <= own.bottom)) {
      return null
    }

    const rest = content.blocks.filter((block) => block.id !== blockId)
    const titles = new Map(
      [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-section-title]") ?? [])].map((title) => [
        title.dataset.sectionTitle,
        title.getBoundingClientRect(),
      ])
    )
    let best: (DropTarget<TemplateBlockSlot> & { distance: number }) | null = null

    for (const slot of listTemplateBlockSlots(content, blockId, false)) {
      const before = box(rest[slot.index - 1]?.id)
      const after = box(rest[slot.index]?.id)
      const title = slot.opens ? titles.get(slot.opens) : undefined
      const edge = after ?? before

      if (!edge || (slot.index === current.index && slot.opens === current.opens && !current.inGroup)) {
        continue
      }

      // Under a title the line sits below it; elsewhere it fills the gap
      // between the blocks either side, even across the gap between pages.
      const top = title ? (title.top + title.bottom) / 2 : (before?.bottom ?? edge.top)
      const bottom = title ? title.bottom : (after?.top ?? edge.bottom)
      const distance = y < top ? top - y : y > bottom ? y - bottom : 0

      if (!best || distance < best.distance) {
        const line = { left: edge.left, top: title || y - top > bottom - y ? bottom : top, width: edge.width }

        best = { distance, line, slot, valid: true }
      }
    }

    return (
      best && {
        line: best.line,
        slot: { kind: "gap", slot: best.slot },
        valid: moveTemplateBlockTo(content, blockId, best.slot, blockId).success,
      }
    )
  }

  // A block let go somewhere new stays chosen, so its place is plain to see.
  function drop(blockId: string, landing: CanvasDrop): void {
    const moved =
      landing.kind === "beside"
        ? controller.placeBeside(blockId, landing.targetId, landing.side)
        : landing.kind === "free"
          ? controller.placeAt(blockId, landing.slot, landing)
          : controller.moveTo(blockId, landing.slot)

    if (moved) {
      controller.select(blockId)
    }
  }

  // A selection across blocks: typing over it or deleting it takes out what
  // lies between its ends, and the caret goes where they joined.
  usePageSelection({
    enabled: textEditable,
    onCaret: controller.requestFocus,
    onReplace(from, to, text) {
      const cut = deleteAcross(content, from, to)

      if (!cut.ok) {
        bizflowToast.error(cut.message)
        return
      }

      const done = controller.edit((page, newId) => {
        const again = deleteAcross(page, from, to)

        if (!again.ok) return { content: page, focus: null }

        const typed = text && again.focus ? insertLines(again.content, again.focus, [text], newId) : null
        return { content: typed?.content ?? again.content, focus: typed?.focus ?? again.focus }
      })

      if (done.focus) controller.requestFocus(done.focus)
    },
    root: rootRef,
  })

  // Enter on an empty item, or Backspace at the start of the first, lifts the
  // item out of the list as a line of text.
  function liftItem(block: ListBlock, entries: readonly ListEntry[], item: number): void {
    const ids: [string, string] = [crypto.randomUUID(), crypto.randomUUID()]
    const lifted = controller.edit((page) =>
      liftListItem(updateTemplateBlock(page, withEntries(block, entries)), block.id, item, { type: "paragraph" }, ids)
    )

    controller.requestFocus(lifted.focus)
  }

  // A click on empty paper puts the caret at the end of that page's writing.
  function focusPageEnd(page: number): void {
    if (!textEditable) {
      return
    }

    const onPage = units.filter((unit) => (layout.pages[unit.id] ?? 0) <= page && unit.id !== "title")
    const last = onPage.at(-1)?.blocks.at(-1)?.block

    if (isLine(last)) {
      controller.requestFocus({ blockId: last.id, offset: last.text.length })
      return
    }

    if (isList(last)) {
      const item = last.items.length - 1
      controller.requestFocus({ blockId: last.id, item, offset: last.items[item]?.length ?? 0 })
      return
    }

    controller.insert(TEXT_CHOICE, { afterBlockId: last?.id ?? null })
  }

  const actions: CanvasEditing["actions"] = {
    onPasteLines(caretKey, lines, from, to) {
      const [blockId = "", item] = caretKey.split(":")
      const point = (offset: number) => (item === undefined ? { blockId, offset } : { blockId, item: Number(item), offset })
      const cut = deleteAcross(content, point(from), point(to))

      if (cut.ok) {
        if (insertLines(cut.content, point(from), lines, () => "").tooLong) {
          bizflowToast.info("That is more than one document can hold. Paste it in parts, or into a new document.")
          return
        }

        const pasted = controller.edit((page, newId) => {
          const again = deleteAcross(page, point(from), point(to))
          return again.ok ? insertLines(again.content, point(from), lines, newId) : { content: page, focus: point(from) }
        })
        controller.requestFocus(pasted.focus)
      }
    },
    onLineInput(block: LineBlock, text: string, runs: TextRun[] | undefined, caret: number): void {
      const shortcut = block.type === "paragraph" ? readMarkdownShortcut(text) : null

      if (shortcut) {
        const list = shortcut.type === "bullet_list" || shortcut.type === "numbered_list"

        setSlash(null)
        controller.change((current) => convertTextBlock(current, block.id, shortcut, { text: "" }).content)
        controller.requestFocus({ blockId: block.id, item: list ? 0 : undefined, offset: 0 })
        return
      }

      controller.updateBlock({ ...block, runs, text }, `text:${block.id}`)
      updateSlash(block.id, text, caret)
    },
    onLineKeyDown(event: globalThis.KeyboardEvent, caret: TextCaret, block: LineBlock): void {
      if (handleSlashKey(event, block.id) || event.isComposing) {
        return
      }

      const synced = { ...block, runs: caret.runs, text: caret.text }
      const mod = event.metaKey || event.ctrlKey

      if (event.key === "Enter") {
        event.preventDefault()
        const id = crypto.randomUUID()
        const opensAbove = caret.offset === 0 && caret.text.length > 0 && !mod

        // With Ctrl or Cmd, as in Google Docs, what follows the caret starts a new page.
        controller.change((current) => {
          const split = splitTextBlock(updateTemplateBlock(current, synced), block.id, caret.offset, id).content

          return mod ? addPageBreak(split, opensAbove ? block.id : id) : split
        })
        controller.requestFocus(opensAbove ? { blockId: block.id, offset: 0 } : { blockId: id, offset: 0 })
      } else if (event.key === "Backspace" && caret.atStart && caret.collapsed) {
        if (content.sections.some((section) => section.startBlockId === block.id)) {
          event.preventDefault()
          focusNeighbour(block.id, -1)
          return
        }
        event.preventDefault()
        const result = controller.edit((page) => mergeIntoPrevious(updateTemplateBlock(page, synced), block.id))

        if (result.focus) {
          controller.requestFocus(result.focus)
        } else if (result.select) {
          controller.select(result.select)
        }
      } else if (event.key === "Delete" && caret.atEnd && caret.collapsed) {
        const index = content.blocks.findIndex((candidate) => candidate.id === block.id)
        const next = content.blocks[index + 1]

        if (isLine(next)) {
          event.preventDefault()
          controller.change((current) => mergeIntoPrevious(updateTemplateBlock(current, synced), next.id).content)
          controller.requestFocus({ blockId: block.id, offset: caret.text.length })
        }
      } else if (
        ((event.key === "ArrowUp" && caret.atStart) || (event.key === "ArrowDown" && caret.atEnd)) &&
        focusNeighbour(block.id, event.key === "ArrowUp" ? -1 : 1)
      ) {
        event.preventDefault()
      } else if (event.key === "Escape") {
        event.preventDefault()
        controller.select(block.id)
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault()
        controller.duplicate(block.id)
      }
    },
    onListInput(block: ListBlock, item: number, text: string, runs: TextRun[] | undefined): void {
      controller.updateBlock(
        withEntries(block, listEntries(block).map((entry, index) => (index === item ? { runs, text } : entry))),
        `list:${block.id}:${item}`
      )
    },
    onListKeyDown(event: globalThis.KeyboardEvent, caret: TextCaret, block: ListBlock, item: number): void {
      if (event.isComposing) {
        return
      }

      const entries = listEntries(block).map((entry, index) =>
        index === item ? { runs: caret.runs, text: caret.text } : entry
      )

      if (event.key === "Enter") {
        event.preventDefault()

        if (caret.text.length === 0) {
          liftItem(block, entries, item)
          return
        }

        const next = [
          ...entries.slice(0, item),
          { runs: sliceRuns(caret.runs, 0, caret.offset), text: caret.text.slice(0, caret.offset) },
          { runs: sliceRuns(caret.runs, caret.offset), text: caret.text.slice(caret.offset) },
          ...entries.slice(item + 1),
        ]

        controller.change((current) => updateTemplateBlock(current, withEntries(block, next)))
        controller.requestFocus({ blockId: block.id, item: item + 1, offset: 0 })
      } else if (event.key === "Backspace" && caret.atStart && caret.collapsed) {
        event.preventDefault()

        if (item > 0) {
          const previous = entries[item - 1] ?? { text: "" }
          const merged = [
            ...entries.slice(0, item - 1),
            { runs: joinRuns(previous, { runs: caret.runs, text: caret.text }), text: previous.text + caret.text },
            ...entries.slice(item + 1),
          ]

          controller.change((current) => updateTemplateBlock(current, withEntries(block, merged)))
          controller.requestFocus({ blockId: block.id, item: item - 1, offset: previous.text.length })
          return
        }

        liftItem(block, entries, 0)
      } else if (event.key === "ArrowUp" && caret.atStart) {
        event.preventDefault()

        if (item > 0) {
          controller.requestFocus({ blockId: block.id, item: item - 1, offset: entries[item - 1]?.text.length ?? 0 })
        } else {
          focusNeighbour(block.id, -1)
        }
      } else if (event.key === "ArrowDown" && caret.atEnd) {
        event.preventDefault()

        if (item < entries.length - 1) {
          controller.requestFocus({ blockId: block.id, item: item + 1, offset: 0 })
        } else {
          focusNeighbour(block.id, 1)
        }
      } else if (event.key === "Escape") {
        event.preventDefault()
        controller.select(block.id)
      }
    },
    startDrag: textEditable ? begin : undefined,
    placeholderFor(blockId: string): string | undefined {
      if (!textEditable) {
        return undefined
      }

      const only = content.blocks.length === 1 && content.blocks[0]?.id === blockId

      return only || controller.activeBlockId === blockId ? "Type / to add" : undefined
    },
  }

  return {
    actions,
    dragging,
    focusPageEnd,
    overlays: (
      <>
        {slash && SlashMenu ? (
          <SlashMenu
            activeIndex={slash.active}
            anchor={slash.anchor}
            choices={slashChoices}
            onChoose={chooseSlash}
            onHover={(active) => setSlash({ ...slash, active })}
          />
        ) : null}
        {dragging
          ? createPortal(
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none fixed z-50 h-0.5 -translate-y-1/2 rounded-full bg-primary data-[valid=false]:bg-destructive"
                  hidden
                  ref={indicator}
                />
                {/* The lines a moving block lines up with. */}
                <div aria-hidden="true" className="pointer-events-none [&>div]:fixed [&>div]:z-50 [&>div]:bg-primary/70" ref={guides} />
              </>,
              document.body
            )
          : null}
      </>
    ),
  }
}

// A gap measured as a drawing marks one: a line down it with a tick at each end.
function measure(x: number, top: number, height: number): DragLine[] {
  return [
    { height, left: x, top, width: 1 },
    { height: 1, left: x - 4, top, width: 9 },
    { height: 1, left: x - 4, top: top + height - 1, width: 9 },
  ]
}

function readCaretRect(): DOMRect {
  const selection = window.getSelection()
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const rect = range?.getBoundingClientRect()

  if (rect && (rect.width > 0 || rect.height > 0 || rect.left > 0)) {
    return rect
  }

  const node = selection?.focusNode
  const element = node instanceof Element ? node : (node?.parentElement ?? document.activeElement)

  return element?.getBoundingClientRect() ?? new DOMRect()
}

// The sides of a block alone on its line: drag one to make the block
// narrower or wider, lining up with the margins, the page's middle and other
// blocks' edges. The keyboard does the same from the block (see nudgeFrame).
export function FrameEdges({ blockId, controller, frame }: { blockId: string; controller: EditorController; frame: BlockFrame | null }): ReactElement {
  const box = frame ?? { left: 0, width: 100 }

  function drag(side: "left" | "right", event: PointerEvent<HTMLDivElement>): void {
    const line = event.currentTarget.closest<HTMLElement>("[data-unit-id]")?.getBoundingClientRect()

    if (!line || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    const others = [...document.querySelectorAll<HTMLElement>("[data-block-id]")].filter((element) => element.dataset.blockId !== blockId)
    const edges = [0, 50, 100, ...others.flatMap((element) => {
      const rect = element.getBoundingClientRect()
      return [rect.left, (rect.left + rect.right) / 2, rect.right].map((x) => ((x - line.left) / line.width) * 100)
    })]
    const asked = ((event.clientX - line.left) / line.width) * 100
    const near = edges.reduce((best, edge) => (Math.abs(edge - asked) < Math.abs(best - asked) ? edge : best), Infinity)
    const at = (Math.abs(near - asked) / 100) * line.width <= SNAP_PX ? near : asked
    const right = box.left + box.width
    const next = side === "left" ? { left: Math.min(Math.max(0, at), right - 5), right } : { left: box.left, right: Math.max(Math.min(100, at), box.left + 5) }

    controller.change((content) => setBlockRule(content, blockId, { frame: frameOf(next.left, next.right - next.left) }), `frame:${blockId}`)
  }

  return (
    <>
      {(["left", "right"] as const).map((side) => (
        <div
          aria-hidden="true"
          className={cn(
            // Over the margins' guides, which a block filling its line sits on.
            "absolute inset-y-0 z-30 w-3 cursor-ew-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60",
            // Just outside the block, so a click on its words still reaches them.
            side === "left" ? "right-full" : "left-full"
          )}
          data-slot="frame-edge"
          key={side}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => drag(side, event)}
        />
      ))}
    </>
  )
}

/**
 * Alt and an arrow move a block alone on its line across the page, or down;
 * with Shift, across makes it narrower or wider.
 *
 * @param controller - The page's controller.
 * @param blockId - The block the keys were pressed on.
 * @param event - The arrow key, with Alt and perhaps Shift.
 * @returns Whether the block moved, which a block in a row never does.
 */
export function nudgeFrame(controller: EditorController, blockId: string, event: KeyboardEvent<HTMLElement>): boolean {
  const content = controller.content

  if ((rowOf(content, blockId)?.columns ?? 1) > 1) {
    return false
  }

  const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1
  const down = event.key === "ArrowUp" || event.key === "ArrowDown"
  const wider = event.shiftKey

  // From the block's place as it is when the change lands, so a step is never lost.
  controller.change((current) => {
    const rule = current.blockRules.find((candidate) => candidate.blockId === blockId)
    const { left, width } = rule?.frame ?? { left: 0, width: 100 }

    return setBlockRule(
      current,
      blockId,
      down
        ? { spaceAbove: Math.max(0, (rule?.spaceAbove ?? 0) + step * 2) }
        : { frame: wider ? frameOf(left, Math.max(5, width + step)) : frameOf(Math.min(Math.max(0, left + step), 100 - width), width) }
    )
  }, down ? `space:${blockId}` : `frame:${blockId}`)

  return true
}
