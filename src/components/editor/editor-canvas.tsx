"use client"

import { Plus } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  findInsertChoices,
  INSERT_CHOICES,
  type InsertChoice,
} from "@/components/editor/block-catalog"
import type { TextCaret } from "@/components/editor/editable-text"
import {
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
import { SectionPieces } from "./section-pieces"
import { EditorSection } from "./editor-section"
import { MarginGuides } from "@/components/editor/margin-guides"
import { SlashMenu } from "@/components/editor/slash-menu"
import { addPageBreak, type EditorController, type FocusRequest } from "@/components/editor/use-editor-controller"
import { resolveDocumentSurfaceInk, type DocumentSurface } from "@/lib/document-surface"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  paragraphGap,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderPlan,
} from "@/services/templates/template-render-plan"
import type { TextRun } from "@/types/template"
import { updateTemplateBlock } from "@/types/template-structure"
import { imageSource } from "@/types/template-images"

/** CSS pixels in a printed point: a page at 100% is its paper's real size. */
export const POINT_PX = 4 / 3
// A phone shows the words reflowed at a size that reads comfortably.
const PHONE_POINT_PX = 1.5
const PAGE_GAP_PX = 36
const FOOTER_POINTS = 18
const EMPTY_ANSWERS: Record<string, unknown> = {}
const TEXT_CHOICE = INSERT_CHOICES[0] as InsertChoice


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
  surface: DocumentSurface
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
  surface,
  textEditable,
  zoom,
}: EditorCanvasProps): ReactElement {
  const content = controller.content
  const plan = useMemo(
    (): TemplateRenderPlan =>
      createTemplateRenderPlan({
        answers,
        content,
        mode: fields === "design" ? "build" : "test",
        title: documentTitle,
      }),
    [answers, content, documentTitle, fields]
  )
  const units = useMemo(() => createUnits(plan), [plan])
  const placedImages = plan.blocks.flatMap(({ block }) =>
    block.type === "image" && block.placement ? [{ block, page: block.placement.page }] : []
  )
  const ink = resolveDocumentSurfaceInk(surface, plan.branding)
  const point = narrow ? PHONE_POINT_PX : POINT_PX * plan.geometry.scale
  const pageWidth = plan.geometry.widthPoints * point
  const pageHeight = plan.geometry.heightPoints * point
  const margins = {
    bottom: plan.geometry.margins.bottom * point,
    left: plan.geometry.margins.left * point,
    right: plan.geometry.margins.right * point,
    top: plan.geometry.margins.top * point,
  }
  const blockGap = paragraphGap(plan.layout) * point
  const logo = imageSource(plan.branding.logoAsset, plan.branding.logoDataUrl)
  const hasBranding = Boolean(logo || plan.branding.organizationName)
  const rootRef = useRef<HTMLDivElement>(null)
  const unitElements = useRef(new Map<string, HTMLElement>())
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [layout, setLayout] = useState<ReturnType<typeof paginate>>({ inside: {}, pageCount: 1, pages: {}, spacers: {} })
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [fontsReady, setFontsReady] = useState(0)
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

  const actions: CanvasActions = {
    answers,
    controller,
    designable,
    fields,
    focusFor(caretKey: string): FocusRequest | null {
      const focus = controller.focus

      return focus && (focus.item === undefined ? focus.blockId : `${focus.blockId}:${focus.item}`) === caretKey
        ? focus
        : null
    },
    onAnswerChange,
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
    "--doc-line-height": plan.layout.lineSpacing,
    ...(narrow ? { "--doc-h1": "1.55em", "--doc-h2": "1.35em", "--doc-h3": "1.15em", "--doc-title": "1.7em" } : {}),
    fontSize: 10 * point,
  } as CSSProperties
  const flow = units.map((unit: CanvasUnit) => (
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
        data-section-id={unit.blocks[0]?.sectionId ?? undefined}
        ref={(element) => {
          if (element) {
            unitElements.current.set(unit.id, element)
          } else {
            unitElements.current.delete(unit.id)
          }
        }}
        style={{ paddingBottom: blockGap }}
      >
        {unit.id === "title" ? (
          <h1
            className="font-semibold"
            data-printed-title=""
            style={{ color: "var(--doc-primary)", fontSize: "var(--doc-title, 2.2em)", lineHeight: 1.25 }}
          >
            {plan.title}
          </h1>
        ) : (
          <UnitBlocks actions={actions} unit={unit} />
        )}
      </div>
    </Fragment>
  ))

  if (narrow) {
    return (
      <div
        className="relative mx-auto w-full max-w-2xl bg-card px-5 py-6 shadow-sm"
        data-document-surface={surface}
        data-slot="editor-pages"
        ref={rootRef}
        style={inkStyle}
      >
        {flow}
        {textEditable ? <SectionPieces root={rootRef} sectionId={controller.currentSectionId} narrow zoom={1} revision={content} /> : null}
        {/* A phone's column has no pages, so placed pictures follow the text. */}
        {placedImages.map(({ block }) => (
          <CanvasBlock actions={actions} block={block} key={block.id} />
        ))}
        {units.length === 0 ? <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} /> : null}
        {textEditable ? (
          <AddPageButton className="mt-6" onClick={() => controller.addPage(content.blocks.at(-1)?.id ?? null)} />
        ) : null}
        {slash ? (
          <SlashMenu
            activeIndex={slash.active}
            anchor={slash.anchor}
            choices={slashChoices}
            onChoose={chooseSlash}
            onHover={(active) => setSlash({ ...slash, active })}
          />
        ) : null}
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
        data-document-surface={surface}
        data-slot="editor-pages"
        ref={rootRef}
        style={{ ...inkStyle, height: stackHeight, transform: `scale(${zoom})`, width: pageWidth }}
      >
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
        {/* Placed pictures lie over their pages' text, as they print. */}
        {placedImages.map(({ block, page }) => (
          <div
            className="pointer-events-none absolute inset-x-0 z-10"
            key={block.id}
            style={{ height: pageHeight, top: (page - 1) * (pageHeight + PAGE_GAP_PX) }}
          >
            <CanvasBlock actions={actions} block={block} placed />
          </div>
        ))}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          data-slot="page-flow"
          style={{ paddingLeft: margins.left, paddingRight: margins.right, paddingTop: frame.marginTop(0) }}
        >
          <PageBreaks.Provider value={layout.inside}>{flow}</PageBreaks.Provider>
          {units.length === 0 ? (
            <div className="pointer-events-auto">
              <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} />
            </div>
          ) : null}
        </div>
      </div>
      {slash ? (
        <SlashMenu
          activeIndex={slash.active}
          anchor={slash.anchor}
          choices={slashChoices}
          onChoose={chooseSlash}
          onHover={(active) => setSlash({ ...slash, active })}
        />
      ) : null}
    </div>
  )
}

function UnitBlocks({ actions, unit }: { actions: CanvasActions; unit: CanvasUnit }): ReactElement {
  return (
    <>
      {unit.sectionId && actions.textEditable ? (
        <EditorSection controller={actions.controller} section={actions.controller.content.sections.find((section) => section.id === unit.sectionId)!} />
      ) : unit.sectionLabel ? (
        <p className="font-semibold" style={{ color: "var(--doc-primary)", fontSize: "1.5em", marginBottom: "0.5em" }}>
          {unit.sectionLabel}
        </p>
      ) : null}
      {unit.groupLabel ? (
        <p className="tracking-[0.08em] text-muted-foreground uppercase" style={{ fontSize: "0.8em", marginBottom: "0.6em" }}>
          {unit.groupLabel}
        </p>
      ) : null}
      <div className={cn("grid", unit.columns === 2 && "grid-cols-2")} style={{ gap: "1.2em" }}>
        {unit.blocks.map((renderBlock) => (
          <CanvasBlock actions={actions} block={renderBlock.block} key={renderBlock.block.id} />
        ))}
      </div>
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

