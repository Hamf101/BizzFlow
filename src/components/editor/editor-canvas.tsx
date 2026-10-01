"use client"

import { Plus } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"

import {
  findInsertChoices,
  INSERT_CHOICES,
  type InsertChoice,
} from "@/components/editor/block-catalog"
import type { TextCaret } from "@/components/editor/editable-text"
import {
  BlockContextMenu,
  CanvasBlock,
  type CanvasActions,
  isLine,
  isList,
  type LineBlock,
  type ListBlock,
  PAGE_BREAKS_FOLDED,
  PageBreaks,
} from "@/components/editor/editor-block"
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
import { type CanvasUnit, createUnits, paginate, type PageFrame, type PaginationRow } from "@/components/editor/editor-pagination"
import { usePageSelection } from "@/components/editor/page-selection"
import { bizflowToast } from "@/components/ui/toaster"
import { SectionPieces } from "./section-pieces"
import { EditorSection } from "./editor-section"
import { MarginGuides } from "@/components/editor/margin-guides"
import { PRINTED_HEADING, printedSpace, SECTION_TITLE } from "@/components/editor/paper-field"
import { SlashMenu } from "@/components/editor/slash-menu"
import { SNAP_PX, snapBox } from "@/components/editor/image-placement"
import { type DragBox, type DragLine, type DropTarget, useBlockDrag } from "@/components/editor/use-block-drag"
import { rowGridColumns } from "@/components/templates/template-render-groups"
import { addPageBreak, type EditorController, type FocusRequest } from "@/components/editor/use-editor-controller"
import { resolveDocumentSurfaceInk } from "@/lib/document-surface"
import { getVisibleTemplateBlocks } from "@/types/template-visibility"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  blockSpacingAdjustment,
  columnGap,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderPlan,
} from "@/services/templates/template-render-plan"
import type { BlockFrame, TextRun } from "@/types/template"
import {
  getTemplateBlockSlot,
  listTemplateBlockSlots,
  moveTemplateBlockTo,
  placeBeside,
  frameOf,
  setBlockRule,
  type TemplateBlockSlot,
  updateTemplateBlock,
} from "@/types/template-structure"
import { imageSource } from "@/types/template-images"

/** CSS pixels in a printed point: a page at 100% is its paper's real size. */
export const POINT_PX = 4 / 3
// A phone shows the words reflowed at a size that reads comfortably.
const PHONE_POINT_PX = 1.5
const PAGE_GAP_PX = 36
const FOOTER_POINTS = 18
const EMPTY_ANSWERS: Record<string, unknown> = {}
const EMPTY_IDS: ReadonlySet<string> = new Set()
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

export type EditorCanvasProps = Readonly<{
  allowFiles: boolean
  answers?: Record<string, unknown>
  controller: EditorController
  /** Whether fields can be selected and set up while they are being filled. */
  designable: boolean
  documentTitle: string
  fields: "design" | "fill" | "read"
  narrow: boolean
  onAnswerChange?: (fieldKey: string, value: unknown) => void
  /** Drawn over the pages at their shown size, such as where others are. */
  overlay?: ReactNode
  textEditable: boolean
  zoom: number
}>

/**
 * The document itself: pages of paper at their real proportions, laid out the
 * way they will print, with text typed straight onto them. On a phone the
 * words reflow into one readable column instead.
 *
 * @param props - The controller, what can be edited, and how it is shown.
 * @returns The pages.
 */
export function EditorCanvas({
  allowFiles,
  answers = EMPTY_ANSWERS,
  controller,
  designable,
  documentTitle,
  fields,
  narrow,
  onAnswerChange = () => undefined,
  overlay,
  textEditable,
  zoom,
}: EditorCanvasProps): ReactElement {
  const content = controller.content
  const plan = useMemo(
    (): TemplateRenderPlan =>
      createTemplateRenderPlan({
        answers,
        content,
        // While the page can be built every block shows, even one its rule hides.
        mode: fields === "design" || designable ? "build" : "test",
        title: documentTitle,
      }),
    [answers, content, designable, documentTitle, fields]
  )
  // What the answers so far would hide, faded on a page still being built.
  const hiddenByRule = useMemo(() => {
    if (!designable || fields === "design") return EMPTY_IDS

    const shown = new Set(getVisibleTemplateBlocks(content, answers).map((block) => block.id))

    return new Set(content.blocks.filter((block) => !shown.has(block.id)).map((block) => block.id))
  }, [answers, content, designable, fields])
  const units = useMemo(() => createUnits(plan), [plan])
  const unitOf = useMemo(
    () => new Map(units.flatMap((unit) => unit.blocks.map(({ block }): [string, string] => [block.id, unit.id]))),
    [units]
  )
  const placedImages = plan.blocks.flatMap(({ block }) =>
    block.type === "image" && block.placement ? [{ block, page: block.placement.page }] : []
  )
  // Always the screen: the page keeps the theme it is read in, a proposal included.
  const ink = resolveDocumentSurfaceInk("screen", plan.branding)
  const point = narrow ? PHONE_POINT_PX : POINT_PX * plan.geometry.scale
  const pageWidth = plan.geometry.widthPoints * point
  const pageHeight = plan.geometry.heightPoints * point
  const margins = {
    bottom: plan.geometry.margins.bottom * point,
    left: plan.geometry.margins.left * point,
    right: plan.geometry.margins.right * point,
    top: plan.geometry.margins.top * point,
  }
  const logo = imageSource(plan.branding.logoAsset, plan.branding.logoDataUrl)
  const hasBranding = Boolean(logo || plan.branding.organizationName)
  const rootRef = useRef<HTMLDivElement>(null)
  const unitElements = useRef(new Map<string, HTMLElement>())
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [layout, setLayout] = useState<ReturnType<typeof paginate>>({ inside: {}, pageCount: 1, pages: {}, spacers: {} })
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [fontsReady, setFontsReady] = useState(0)
  const { begin, dragging, guides, indicator } = useBlockDrag<CanvasDrop>({ lift: !narrow, locate, onDrop: drop, zoom: narrow ? 1 : zoom })
  const slashChoices = useMemo(
    () => (slash ? findInsertChoices({ allowFiles, query: slash.query }) : []),
    [allowFiles, slash]
  )
  const headerOn = (page: number): boolean =>
    hasBranding && shouldRenderTemplateHeader(plan.layout, page + 1)
  const footerOn = (page: number): boolean =>
    shouldRenderTemplateFooter(plan.layout, page + 1) && plan.layout.pageNumbering === "page_x_of_y"
  const frame: PageFrame = {
    gap: PAGE_GAP_PX,
    height: pageHeight,
    marginBottom: (page) => margins.bottom + (footerOn(page) ? FOOTER_POINTS * point : 0),
    marginTop: (page) => margins.top + (headerOn(page) ? headerHeight : 0),
  }

  useEffect(() => {
    const remeasure = (): void => setFontsReady((count) => count + 1)
    void document.fonts?.ready.then(remeasure)
    document.fonts?.addEventListener("loadingdone", remeasure)
    return () => document.fonts?.removeEventListener("loadingdone", remeasure)
  }, [])

  // Measure every render: typing changes heights, and so do fonts and images.
  // It settles because state changes only when the measured pages differ.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (narrow) {
      return
    }

    const measuredHeader = headerRef.current?.offsetHeight ?? 0

    if (measuredHeader !== headerHeight) {
      setHeaderHeight(measuredHeader)
      return
    }

    // Only a block taller than the smallest page needs its rows: nothing else breaks.
    const room = Math.min(frame.height - frame.marginTop(0) - frame.marginBottom(0), frame.height - frame.marginTop(1) - frame.marginBottom(1))
    const folded = Object.keys(layout.inside).length > 0
    const style = rootRef.current?.style

    if (folded) {
      Object.entries(PAGE_BREAKS_FOLDED).forEach(([name, value]) => style?.setProperty(name, value))
    }

    const next = paginate(
      units.map((unit) => {
        const element = unitElements.current.get(unit.id)
        const height = element?.offsetHeight ?? 0

        return {
          height,
          id: unit.id,
          keepWithNext: unit.keepWithNext,
          pageBreakBefore: unit.pageBreakBefore,
          together: unit.together,
          rows: element && height > room ? measureRows(element, zoom) : undefined,
        }
      }),
      frame
    )

    if (folded) {
      Object.keys(PAGE_BREAKS_FOLDED).forEach((name) => style?.removeProperty(name))
    }

    if (JSON.stringify(next) !== JSON.stringify(layout)) {
      setLayout(next)
    }
  })

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

      const typed = text && cut.focus ? insertLines(cut.content, cut.focus, [text], () => crypto.randomUUID()) : null

      controller.change(() => typed?.content ?? cut.content)

      if (typed?.focus ?? cut.focus) controller.requestFocus(typed?.focus ?? cut.focus!)
    },
    root: rootRef,
  })

  const actions: CanvasActions = {
    answers,
    controller,
    designable,
    dragging,
    fields,
    hiddenByRule,
    narrow,
    focusFor(caretKey: string): FocusRequest | null {
      const focus = controller.focus

      return focus && (focus.item === undefined ? focus.blockId : `${focus.blockId}:${focus.item}`) === caretKey
        ? focus
        : null
    },
    onAnswerChange,
    onPasteLines(caretKey, lines, from, to) {
      const [blockId = "", item] = caretKey.split(":")
      const point = (offset: number) => (item === undefined ? { blockId, offset } : { blockId, item: Number(item), offset })
      const cut = deleteAcross(content, point(from), point(to))

      if (cut.ok) {
        const pasted = insertLines(cut.content, point(from), lines, () => crypto.randomUUID())

        if (pasted.tooLong) {
          bizflowToast.info("That is more than one document can hold. Paste it in parts, or into a new document.")
          return
        }

        controller.change(() => pasted.content)
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
        const result = mergeIntoPrevious(updateTemplateBlock(content, synced), block.id)

        event.preventDefault()
        controller.change(() => result.content)

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
          controller.change(() => mergeIntoPrevious(updateTemplateBlock(content, synced), next.id).content)
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
    textEditable,
  }

  // Enter on an empty item, or Backspace at the start of the first, lifts the
  // item out of the list as a line of text.
  function liftItem(block: ListBlock, entries: readonly ListEntry[], item: number): void {
    const lifted = liftListItem(
      updateTemplateBlock(content, withEntries(block, entries)),
      block.id,
      item,
      { type: "paragraph" },
      [crypto.randomUUID(), crypto.randomUUID()]
    )

    controller.change(() => lifted.content)
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

  const inkStyle = {
    "--doc-accent": ink.accent,
    "--doc-primary": ink.primary,
    "--doc-pt": `${point}px`,
    // The PDF's spacing: what the layout adds under each block, and between a row's columns.
    "--doc-adjust": `${blockSpacingAdjustment(plan.layout) * point}px`,
    "--doc-column-gap": `${columnGap(plan.geometry.contentWidthPoints) * point}px`,
    "--doc-line-height": plan.layout.lineSpacing,
    ...(narrow ? { "--doc-h1": "1.55em", "--doc-h2": "1.35em", "--doc-h3": "1.15em", "--doc-title": "1.7em" } : {}),
    // The face the PDF prints in, so words wrap on the page where they will print.
    fontFamily: '"bf-default", sans-serif',
    fontSize: 10 * point,
  } as CSSProperties
  const unitNode = (unit: CanvasUnit): ReactElement => (
    <Fragment key={unit.id}>
      {!narrow && layout.spacers[unit.id] ? (
        <div aria-hidden="true" style={{ height: layout.spacers[unit.id] }} />
      ) : null}
      {narrow && unit.pageBreakBefore && unit.id !== units[0]?.id ? (
        <div aria-label="Page break" className="my-[1.2em] border-t border-dashed border-border" role="separator" />
      ) : null}
      <div
        className="pointer-events-auto"
        data-unit-id={unit.id}
        // The space asked for above it; a phone's column keeps its own rhythm.
        style={narrow || !unit.space ? undefined : { paddingTop: unit.space * point }}
        data-section-id={unit.blocks[0]?.sectionId ?? undefined}
        ref={(element) => {
          if (element) {
            unitElements.current.set(unit.id, element)
          } else {
            unitElements.current.delete(unit.id)
          }
        }}
      >
        {unit.id === "title" ? (
          <h1
            className="font-bold"
            data-printed-title=""
            style={{ ...PRINTED_HEADING, color: "var(--doc-primary)", fontSize: "var(--doc-title, 2.4em)", lineHeight: 35 / 24, marginBottom: printedSpace(16) }}
          >
            {plan.title}
          </h1>
        ) : (
          <UnitBlocks actions={actions} unit={unit} />
        )}
      </div>
    </Fragment>
  )
  // The page's pieces in reading order. A picture placed on a page keeps its
  // place in that order, for a screen reader and a phone's column, and is
  // drawn over its page in its box.
  const emitted = new Set<string>()
  const flow = [
    ...units.filter((unit) => unit.id === "title").map(unitNode),
    ...plan.blocks.flatMap(({ block }) => {
      const box = block.type === "image" ? block.placement : undefined

      if (box) {
        return [
          narrow ? (
            <CanvasBlock actions={actions} block={block} key={block.id} />
          ) : (
            <div
              className="pointer-events-none absolute inset-x-0 z-10"
              key={block.id}
              style={{ height: pageHeight, top: (box.page - 1) * (pageHeight + PAGE_GAP_PX) }}
            >
              <CanvasBlock actions={actions} block={block} placed />
            </div>
          ),
        ]
      }

      const unit = units.find((candidate) => candidate.id === unitOf.get(block.id))

      if (!unit || emitted.has(unit.id)) return []

      emitted.add(unit.id)

      return [unitNode(unit)]
    }),
  ]

  // The line a dragged block would land on, and what a screen reader hears
  // after a move.
  const overlays = (
    <>
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
      {textEditable ? (
        <p aria-live="polite" className="sr-only" data-slot="editor-announcement">
          {controller.announcement}
        </p>
      ) : null}
    </>
  )

  if (narrow) {
    return (
      <div
        className="relative mx-auto w-full max-w-2xl bg-card px-5 py-6 shadow-sm"
        data-document-surface="screen"
        data-slot="editor-pages"
        ref={rootRef}
        style={inkStyle}
      >
        {PRINTED_FACE}
        <BlockContextMenu actions={actions}>{flow}</BlockContextMenu>
        {textEditable ? <SectionPieces root={rootRef} sectionId={controller.currentSectionId} narrow zoom={1} revision={content} /> : null}
        {units.length === 0 ? <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} /> : null}
        {textEditable ? (
          <AddPageButton className="mt-6" onClick={() => controller.addPage(content.blocks.at(-1)?.id ?? null)} />
        ) : null}
        {overlay}
        {slash ? (
          <SlashMenu
            activeIndex={slash.active}
            anchor={slash.anchor}
            choices={slashChoices}
            onChoose={chooseSlash}
            onHover={(active) => setSlash({ ...slash, active })}
          />
        ) : null}
        {overlays}
      </div>
    )
  }

  const pageCount = Math.max(layout.pageCount, ...placedImages.map(({ page }) => page))
  const stackHeight = pageCount * (pageHeight + PAGE_GAP_PX) + (textEditable ? 56 : 0)

  return (
    <div
      className="relative"
      data-font-pass={fontsReady}
      style={{ height: stackHeight * zoom, width: pageWidth * zoom }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        data-document-surface="screen"
        data-slot="editor-pages"
        ref={rootRef}
        style={{ ...inkStyle, height: stackHeight, transform: `scale(${zoom})`, width: pageWidth }}
      >
        {PRINTED_FACE}
        {Array.from({ length: pageCount }, (_, page) => (
          <div
            aria-label={`Page ${page + 1} of ${pageCount}`}
            className="group/page absolute inset-x-0 cursor-text bg-card shadow-[0_1px_2px_rgba(37,35,41,0.08),0_10px_30px_rgba(37,35,41,0.1)]"
            data-page={page + 1}
            key={page}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault()
                focusPageEnd(page)
              }
            }}
            role="region"
            style={{ height: pageHeight, top: page * (pageHeight + PAGE_GAP_PX) }}
          >
            {designable ? (
              <MarginGuides first={page === 0} layout={plan.layout} onChange={controller.setLayout} point={point} zoom={zoom} />
            ) : null}
            {headerOn(page) ? (
              <div
                className={cn(
                  "absolute inset-x-0 flex flex-col gap-[0.3em]",
                  plan.branding.logoAlignment === "center" && "items-center",
                  plan.branding.logoAlignment === "right" && "items-end"
                )}
                ref={page === 0 ? headerRef : undefined}
                style={{ paddingBottom: 10 * point, paddingLeft: margins.left, paddingRight: margins.right, top: margins.top }}
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the author's own picture, already sized
                  <img
                    alt={`${plan.branding.organizationName || "Organization"} logo`}
                    src={logo}
                    style={{ maxHeight: 34 * point, width: `${plan.branding.logoWidthPercent}%`, objectFit: "contain", objectPosition: plan.branding.logoAlignment }}
                  />
                ) : null}
                {plan.branding.organizationName ? (
                  <span className="font-semibold" style={{ color: "var(--doc-primary)", fontSize: "1.2em" }}>
                    {plan.branding.organizationName}
                  </span>
                ) : null}
              </div>
            ) : textEditable && hasBranding ? (
              <MarginPill
                label="Header"
                onClick={() => controller.setLayout({ ...plan.layout, headerPolicy: "all_pages" })}
                zone={{ height: margins.top, top: 0 }}
              />
            ) : null}
            {footerOn(page) ? (
              <p
                className="absolute text-muted-foreground tabular-nums"
                style={{ bottom: margins.bottom * 0.55, fontSize: 8 * point, right: margins.right }}
              >
                Page {page + 1} of {pageCount}
              </p>
            ) : textEditable ? (
              <MarginPill
                label="Page numbers"
                onClick={() =>
                  controller.setLayout({ ...plan.layout, footerPolicy: "all_pages", pageNumbering: "page_x_of_y" })
                }
                zone={{ bottom: 0, height: margins.bottom }}
              />
            ) : null}
            {textEditable ? (
              <AddPageButton
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 -translate-y-1/2",
                  page < pageCount - 1 &&
                    "opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/page:opacity-100"
                )}
                onClick={() => {
                  const lastUnit = units.filter((unit) => (layout.pages[unit.id] ?? 0) <= page).at(-1)

                  controller.addPage(lastUnit?.blocks.at(-1)?.block.id ?? null)
                }}
                style={{ top: pageHeight + (page < pageCount - 1 ? PAGE_GAP_PX / 2 : 28) }}
              />
            ) : null}
          </div>
        ))}
        {textEditable ? <SectionPieces root={rootRef} sectionId={controller.currentSectionId} narrow={false} zoom={zoom} revision={layout} /> : null}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          data-slot="page-flow"
          style={{ paddingLeft: margins.left, paddingRight: margins.right, paddingTop: frame.marginTop(0) }}
        >
          <PageBreaks.Provider value={layout.inside}>
            <BlockContextMenu actions={actions}>{flow}</BlockContextMenu>
          </PageBreaks.Provider>
          {units.length === 0 ? (
            <div className="pointer-events-auto">
              <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} />
            </div>
          ) : null}
        </div>
      </div>
      {overlay}
      {slash ? (
        <SlashMenu
          activeIndex={slash.active}
          anchor={slash.anchor}
          choices={slashChoices}
          onChoose={chooseSlash}
          onHover={(active) => setSlash({ ...slash, active })}
        />
      ) : null}
      {overlays}
    </div>
  )
}

function UnitBlocks({ actions, unit }: { actions: CanvasActions; unit: CanvasUnit }): ReactElement {
  return (
    <>
      {unit.sectionId && actions.textEditable ? (
        <EditorSection controller={actions.controller} section={actions.controller.content.sections.find((section) => section.id === unit.sectionId)!} />
      ) : unit.sectionLabel ? (
        <p className="font-bold" style={SECTION_TITLE}>
          {unit.sectionLabel}
        </p>
      ) : null}
      {unit.groupLabel ? (
        <p className="font-bold text-muted-foreground uppercase" style={{ fontSize: "0.9em", lineHeight: 13 / 9, marginBottom: printedSpace(8) }}>
          {unit.groupLabel}
        </p>
      ) : null}
      <div
        className="relative grid"
        // A row stacks on a phone, where there is no room beside a block.
        // Each block keeps the space the PDF leaves under it, so rows need no gap of their own.
        style={{
          columnGap: "var(--doc-column-gap)",
          gridTemplateColumns: actions.narrow ? undefined : rowGridColumns(unit.columns, unit.widths),
          // A block moved across the page sits where it was put.
          ...(unit.frame && !actions.narrow ? { marginLeft: `${unit.frame.left}%`, width: `${unit.frame.width}%` } : {}),
        }}
      >
        {unit.blocks.map((renderBlock) => (
          <CanvasBlock actions={actions} block={renderBlock.block} key={renderBlock.block.id} />
        ))}
        {actions.textEditable && !actions.narrow ? <RowSeams controller={actions.controller} unit={unit} /> : null}
        {actions.textEditable && !actions.narrow && unit.columns === 1 && unit.blocks[0] ? (
          <FrameEdges blockId={unit.blocks[0].block.id} controller={actions.controller} frame={unit.frame} />
        ) : null}
      </div>
    </>
  )
}


// Given a precedence, React puts the stylesheet in the head once, beside the
// families some words use.
// eslint-disable-next-line @next/next/no-css-tags -- the document face, served by the fonts route like the others
const PRINTED_FACE = <link href="/fonts/default/font.css" precedence="document-fonts" rel="stylesheet" />

// The sides of a block alone on its line: drag one to make the block
// narrower or wider, lining up with the margins, the page's middle and other
// blocks' edges. The keyboard does the same from the block (see nudgeFrame).
function FrameEdges({ blockId, controller, frame }: { blockId: string; controller: EditorController; frame: BlockFrame | null }): ReactElement {
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

// The edges between a row's columns: drag one, or focus it and use the arrow
// keys, to trade width between the columns either side, a twelfth at a time.
function RowSeams({ controller, unit }: { controller: EditorController; unit: CanvasUnit }): ReactElement | null {
  const groupId = unit.blocks[0]?.fieldGroupId
  const widths = unit.widths ?? Array.from({ length: unit.columns }, () => 12 / unit.columns)

  if (!groupId || unit.columns < 2) {
    return null
  }

  return (
    <>
      {widths.slice(0, -1).map((_, index) => {
        const left = widths[index] ?? 0
        const right = widths[index + 1] ?? 0
        const at = widths.slice(0, index + 1).reduce((total, width) => total + width, 0)

        // Each column keeps at least two twelfths.
        function resize(to: number): void {
          const next = Math.min(at + right - 2, Math.max(at - left + 2, Math.round(to)))

          if (next !== at) {
            controller.setRowWidths(
              groupId as string,
              widths.map((width, column) => (column === index ? left + next - at : column === index + 1 ? right - (next - at) : width)),
              `row:${groupId}`
            )
          }
        }

        return (
          <div
            aria-label="Column width"
            aria-orientation="vertical"
            aria-valuemax={10}
            aria-valuemin={2}
            aria-valuenow={left}
            className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60 focus-visible:outline-none focus-visible:after:opacity-100"
            data-slot="row-seam"
            key={index}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault()
                resize(at + (event.key === "ArrowLeft" ? -1 : 1))
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const grid = event.currentTarget.parentElement?.getBoundingClientRect()

              if (grid && event.currentTarget.hasPointerCapture(event.pointerId)) {
                resize(((event.clientX - grid.left) / grid.width) * 12)
              }
            }}
            role="separator"
            style={{ left: `calc((100% - ${widths.length - 1} * var(--doc-column-gap)) * ${at / 12} + ${index + 0.5} * var(--doc-column-gap))` }}
            tabIndex={0}
          />
        )
      })}
    </>
  )
}

function EmptyPageLine({ actions, onStart }: { actions: CanvasActions; onStart: () => void }): ReactElement | null {
  if (!actions.textEditable) {
    return null
  }

  return (
    <p
      className="cursor-text text-muted-foreground/55"
      data-slot="empty-page"
      onMouseDown={(event) => {
        event.preventDefault()
        onStart()
      }}
      style={{ lineHeight: 1.5 }}
    >
      Type / to add
    </p>
  )
}

function AddPageButton({
  className,
  onClick,
  style,
}: {
  className?: string
  onClick: () => void
  style?: CSSProperties
}): ReactElement {
  return (
    <button
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[13px] text-muted-foreground shadow-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        className
      )}
      onClick={onClick}
      onMouseDown={(event) => event.stopPropagation()}
      style={style}
      type="button"
    >
      <Plus aria-hidden="true" className="size-3.5" />
      Add page
    </button>
  )
}

// A pill that appears only while the pointer rests in a page's margin.
function MarginPill({
  label,
  onClick,
  zone,
}: {
  label: string
  onClick: () => void
  zone: CSSProperties
}): ReactElement {
  return (
    <div
      className="group/margin absolute inset-x-0 grid place-items-center"
      onMouseDown={(event) => event.stopPropagation()}
      style={zone}
    >
      <button
        className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-[12px] text-muted-foreground opacity-0 outline-none transition-opacity group-hover/margin:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={onClick}
        type="button"
      >
        <Plus aria-hidden="true" className="size-3" />
        {label}
      </button>
    </div>
  )
}

/**
 * Where a page may end inside a block too tall for one, measured from the
 * block's top: before a list item, before a table row after the first, and
 * before any line of a paragraph but its first.
 *
 * @param unit - The block's element, with every page-break space folded away.
 * @param zoom - The canvas's scale, since the screen reports scaled sizes.
 * @returns The rows, top to bottom.
 */
// A gap measured as a drawing marks one: a line down it with a tick at each end.
function measure(x: number, top: number, height: number): DragLine[] {
  return [
    { height, left: x, top, width: 1 },
    { height: 1, left: x - 4, top, width: 9 },
    { height: 1, left: x - 4, top: top + height - 1, width: 9 },
  ]
}

function measureRows(unit: HTMLElement, zoom: number): PaginationRow[] {
  const origin = unit.getBoundingClientRect().top
  const rows: PaginationRow[] = []

  for (const element of unit.querySelectorAll<HTMLElement>("li[data-line-key], tr[data-row-key]")) {
    rows.push({
      key: element.dataset.lineKey ?? element.dataset.rowKey ?? "",
      top: (element.getBoundingClientRect().top - origin) / zoom,
    })
  }

  // A paragraph is a plain block while it is typed in, and a paragraph otherwise.
  for (const paragraph of unit.querySelectorAll<HTMLElement>("div[data-line-key], p[data-line-key]")) {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    // Each line's box sits the same way inside it, so the first one's top is the paragraph's.
    const [first, ...rest] = [...range.getClientRects()].map((rect) => rect.top)
    const top = (paragraph.getBoundingClientRect().top - origin) / zoom

    for (const line of new Set(rest.map((lineTop) => Math.round((lineTop - (first ?? lineTop)) / zoom)))) {
      if (line > 0) {
        rows.push({ key: `${paragraph.dataset.lineKey}@${line}`, top: top + line })
      }
    }
  }

  return rows.sort((one, other) => one.top - other.top)
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

