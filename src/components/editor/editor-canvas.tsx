"use client"

import { Plus } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  CanvasBlock,
  type CanvasActions,
  isBoxed,
  PAGE_BREAKS_FOLDED,
  PageBreaks,
} from "@/components/editor/editor-block"
import { useDesignTools } from "@/components/editor/design-tools"
import { type CanvasUnit, createUnits, paginate, type PageFrame, type PaginationRow } from "@/components/editor/editor-pagination"
import type { CanvasEditing, CanvasEditingInput } from "@/components/editor/editor-canvas-editing"
import { PrintedSectionTitle, sectionBoxStyle } from "./printed-section"
import { PRINTED_HEADING, printedSpace } from "@/components/editor/paper-field"
import { rowGridColumns } from "@/components/templates/template-render-groups"
import type { EditorController, FocusRequest } from "@/components/editor/use-editor-controller"
import { resolveDocumentSurfaceInk } from "@/lib/document-surface"
import { getVisibleTemplateBlocks, type AnswerSettler } from "@/types/template-visibility"
import { useCalculatedAnswers } from "@/components/editor/use-calculated-answers"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  blockSpacingAdjustment,
  columnGap,
  resolveTemplateMarginWords,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateMarginWords,
  type TemplateRenderPlan,
} from "@/services/templates/template-render-plan"
import { imageSource } from "@/types/template-images"


/** CSS pixels in a printed point: a page at 100% is its paper's real size. */
export const POINT_PX = 4 / 3
// A phone shows the words reflowed at a size that reads comfortably.
const PHONE_POINT_PX = 1.5
const PAGE_GAP_PX = 36
const FOOTER_POINTS = 18
const EMPTY_ANSWERS: Record<string, unknown> = {}
const EMPTY_IDS: ReadonlySet<string> = new Set()
const ignore = (): undefined => undefined
// A canvas no editor provided designing to: its blocks are read or filled in, never typed or moved.
const NO_EDITING: CanvasEditing = {
  actions: { onLineInput: ignore, onLineKeyDown: ignore, onListInput: ignore, onListKeyDown: ignore, onPasteLines: ignore, placeholderFor: ignore },
  dragging: null,
  focusPageEnd: ignore,
  overlays: null,
}
const useNoEditing: (input: CanvasEditingInput) => CanvasEditing = () => NO_EDITING


/** Where a dragged block lands: in a gap between blocks, or beside one, in its row. */

export type EditorCanvasProps = Readonly<{
  allowFiles: boolean
  answers?: Record<string, unknown>
  controller: EditorController
  /** Whether fields can be selected and set up while they are being filled. */
  designable: boolean
  documentTitle: string
  fields: "design" | "fill" | "read"
  narrow: boolean
  /** A change, with how to bring the answers to what the page shows once it is made. */
  onAnswerChange?: (fieldKey: string, value: unknown, settle: AnswerSettler) => void
  /** Drawn over the pages at their shown size, such as where others are. */
  overlay?: ReactNode
  /** What a page that takes uploads puts in a file field while it is filled in. */
  renderFileField?: CanvasActions["renderFileField"]
  /** A blank page just made: the cursor goes on it, as a word processor's New does. */
  startTyping?: boolean
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
  answers: givenAnswers = EMPTY_ANSWERS,
  controller,
  designable,
  documentTitle,
  fields,
  narrow,
  onAnswerChange = () => undefined,
  overlay,
  renderFileField,
  startTyping = false,
  textEditable,
  zoom,
}: EditorCanvasProps): ReactElement {
  const { MarginGuides, MarginTextBand, SectionPieces } = useDesignTools() ?? {}
  // Fixed for the page's life: an editor provides designing before its canvas first draws.
  const useEditing = useDesignTools()?.useCanvasEditing ?? useNoEditing
  const content = controller.content
  const { answers, settle } = useCalculatedAnswers(content, givenAnswers)
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
  const [fontsReady, setFontsReady] = useState(0)
  // The header or footer being written in place, after a double-click in its margin.
  const [writing, setWriting] = useState<{ edge: "header" | "footer"; page: number } | null>(null)
  // eslint-disable-next-line react-hooks/refs -- a hook either way; the editing one reads the refs only in effects and handlers.
  const editing = useEditing({ allowFiles, content, controller, layout, narrow, point, rootRef, textEditable, unitElements, unitOf, units, zoom })
  const { dragging, focusPageEnd } = editing
  const startedTyping = useRef(false)

  // Once, and only on an empty page: a page someone only opened isn't changed.
  useEffect(() => {
    if (!startTyping || !textEditable || startedTyping.current || units.length > 0) return
    startedTyping.current = true
    focusPageEnd(0)
  })
  const headerOn = (page: number): boolean =>
    hasBranding && shouldRenderTemplateHeader(plan.layout, page + 1)
  const footerOn = (page: number): boolean =>
    shouldRenderTemplateFooter(plan.layout, page + 1) && plan.layout.pageNumbering === "page_x_of_y"
  // The words in a page's margins, filled in for that page as they print.
  const marginWords = (page: number, pages: number): ReturnType<typeof resolveTemplateMarginWords> =>
    resolveTemplateMarginWords(plan.layout, page + 1, pages, plan.title || documentTitle)
  const marginText = (edge: "header" | "footer", page: number, pageLabel: string | null, style: CSSProperties): ReactElement | null =>
    designable && MarginTextBand && writing?.edge === edge && writing.page === page ? (
      <MarginTextBand
        edge={edge}
        layout={plan.layout}
        onChange={controller.setLayout}
        onClose={() => setWriting(null)}
        page={page + 1}
        pageLabel={pageLabel}
        style={style}
      />
    ) : null
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


  const actions: CanvasActions = {
    answers,
    controller,
    designable,
    dragging,
    fields,
    fieldStyle: plan.layout.fieldStyle ?? "box",
    hiddenByRule,
    narrow,
    focusFor(caretKey: string): FocusRequest | null {
      const focus = controller.focus

      return focus && (focus.item === undefined ? focus.blockId : `${focus.blockId}:${focus.item}`) === caretKey
        ? focus
        : null
    },
    onAnswerChange: (fieldKey, value) => onAnswerChange(fieldKey, value, settle),
    renderFileField,
    ...editing.actions,
    textEditable,
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
  // A unit whose every block is an answer drawn as a cell.
  const cellUnit = (unit: CanvasUnit): boolean => actions.fieldStyle === "cell" && unit.blocks.length > 0 && unit.blocks.every(({ block }) => isBoxed(block))
  const unitNode = (unit: CanvasUnit): ReactElement => (
    <Fragment key={unit.id}>
      {!narrow && layout.spacers[unit.id] ? (
        <div aria-hidden="true" style={{ height: layout.spacers[unit.id] }} />
      ) : null}
      {narrow && unit.pageBreakBefore && unit.id !== units[0]?.id ? (
        <div aria-label="Page break" className="my-[1.2em] border-t border-dashed border-border" role="separator" />
      ) : null}
      <div
        // Holds its last block's space under it, the printed title's included,
        // so the height pages are laid out by is the room it takes.
        className="pointer-events-auto flow-root"
        // Cells touch the cells below them; a title or space above a unit parts them, as in print.
        data-cell-bottom={cellUnit(unit) ? "" : undefined}
        data-cell-top={cellUnit(unit) && !unit.space && !unit.sectionId && !unit.sectionLabel && !unit.groupLabel ? "" : undefined}
        data-unit-id={unit.id}
        // The space asked for above it; a phone's column keeps its own rhythm.
        // In a boxed section, the box's edges and padding around it too.
        data-section-box={unit.box ? "" : undefined}
        style={
          unit.box
            ? sectionBoxStyle(unit.box, narrow ? 0 : unit.space * point, point)
            : narrow || !unit.space ? undefined : { paddingTop: unit.space * point }
        }
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

  // What designing draws over the page, and what a screen reader hears after a move.
  const overlays = (
    <>
      {editing.overlays}
      {textEditable ? (
        <p aria-live="polite" className="sr-only" data-slot="editor-announcement">
          {controller.announcement}
        </p>
      ) : null}
    </>
  )

  if (narrow) {
    // One column, no pages: the margin words once above it and once below,
    // each as wide as it needs where the column has room.
    const columnWords = marginWords(0, 1)

    return (
      <div
        className="relative mx-auto w-full max-w-2xl bg-card px-5 py-6 shadow-sm"
        data-document-surface="screen"
        data-slot="editor-pages"
        // A double-tap above the writing writes the header, below it the footer.
        onDoubleClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const edge = event.clientY - box.top < 56 ? "header" : box.bottom - event.clientY < 96 ? "footer" : null

          if (designable && edge && event.target === event.currentTarget) setWriting({ edge, page: 0 })
        }}
        ref={rootRef}
        style={inkStyle}
      >
        {PRINTED_FACE}
        {CELL_JOINS}
        {marginText("header", 0, null, { fontSize: 12, marginBottom: 16, position: "relative" }) ?? (
          <MarginWords className="mb-4 text-[11px]" words={columnWords.header} />
        )}
        <Selectable actions={actions}>{flow}</Selectable>
        {textEditable && SectionPieces ? <SectionPieces root={rootRef} sectionId={controller.currentSectionId} narrow zoom={1} revision={content} /> : null}
        {units.length === 0 ? <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} /> : null}
        {marginText("footer", 0, columnWords.pageLabel, { fontSize: 12, marginTop: 24, position: "relative" }) ?? (
          <MarginWords className="mt-6 text-[11px]" words={columnWords.footer} />
        )}
        {textEditable ? (
          <AddPageButton className="mt-6" onClick={() => controller.addPage(content.blocks.at(-1)?.id ?? null)} />
        ) : null}
        {overlay}
        {overlays}
      </div>
    )
  }

  const pageCount = Math.max(layout.pageCount, ...placedImages.map(({ page }) => page))
  const stackHeight = pageCount * (pageHeight + PAGE_GAP_PX) + (textEditable ? 56 : 0)
  const pageWords = Array.from({ length: pageCount }, (_, page) => marginWords(page, pageCount))
  const wordsSize = 7.5 * point
  const wordsInset: CSSProperties = { fontSize: wordsSize, left: margins.left, right: margins.right }
  // Which margin a point on a page is in, where its words can be written.
  const marginEdgeAt = (event: MouseEvent<HTMLElement>): "header" | "footer" | null => {
    if (!designable || !MarginTextBand) return null

    const y = (event.clientY - event.currentTarget.getBoundingClientRect().top) / zoom

    return y < margins.top ? "header" : y > pageHeight - margins.bottom ? "footer" : null
  }
  const bandInset: CSSProperties = { fontSize: wordsSize, paddingLeft: margins.left, paddingRight: margins.right }

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
        {CELL_JOINS}
        {Array.from({ length: pageCount }, (_, page) => (
          <div
            aria-label={`Page ${page + 1} of ${pageCount}`}
            className="group/page absolute inset-x-0 cursor-text bg-card shadow-[0_1px_2px_rgba(37,35,41,0.08),0_10px_30px_rgba(37,35,41,0.1)]"
            data-page={page + 1}
            key={page}
            // As a word processor: a double-click in the top margin writes the header, in the bottom one the footer.
            onDoubleClick={(event) => {
              const edge = marginEdgeAt(event)

              if (edge && !(event.target as Element).closest('[data-slot="margin-text-band"]')) setWriting({ edge, page })
            }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault()
                // A click in the top or bottom margin leaves the caret, and the page, where they are, for a double-click there.
                if (!marginEdgeAt(event)) focusPageEnd(page)
              }
            }}
            role="region"
            style={{ height: pageHeight, top: page * (pageHeight + PAGE_GAP_PX) }}
          >
            {designable && MarginGuides ? (
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
            {marginText("header", page, null, { ...bandInset, minHeight: "3.6em", height: margins.top, top: 0 })}
            {marginText("footer", page, pageWords[page].pageLabel, { ...bandInset, bottom: 0, minHeight: "3.6em", height: margins.bottom })}
            {/* Baselines as the PDF sets them: midway down the top margin, midway up the bottom. */}
            <MarginWords
              className="absolute"
              style={{ ...wordsInset, top: margins.top / 2 + 2.5 * point - WORDS_ASCENT_EM * wordsSize }}
              words={pageWords[page].header}
            />
            <MarginWords
              className="absolute"
              style={{ ...wordsInset, bottom: margins.bottom / 2 - (WORDS_LINE_EM - WORDS_ASCENT_EM) * wordsSize }}
              words={pageWords[page].pageLabel ? { ...pageWords[page].footer, right: pageWords[page].pageLabel } : pageWords[page].footer}
            />
            {pageWords[page].pageLabel ? null : textEditable && !footerOn(page) && Object.keys(pageWords[page].footer).length === 0 ? (
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
        {textEditable && SectionPieces ? <SectionPieces root={rootRef} sectionId={controller.currentSectionId} narrow={false} zoom={zoom} revision={layout} /> : null}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          data-slot="page-flow"
          style={{ paddingLeft: margins.left, paddingRight: margins.right, paddingTop: frame.marginTop(0) }}
        >
          <PageBreaks.Provider value={layout.inside}>
            <Selectable actions={actions}>{flow}</Selectable>
          </PageBreaks.Provider>
          {units.length === 0 ? (
            <div className="pointer-events-auto">
              <EmptyPageLine actions={actions} onStart={() => focusPageEnd(0)} />
            </div>
          ) : null}
        </div>
      </div>
      {overlay}
      {overlays}
    </div>
  )
}

function UnitBlocks({ actions, unit }: { actions: CanvasActions; unit: CanvasUnit }): ReactElement {
  const { EditorSection, FrameEdges } = useDesignTools() ?? {}
  const cue = [...new Set(unit.blocks.flatMap((renderBlock) => (renderBlock.cue ? [renderBlock.cue] : [])))].join("  ·  ")
  const printedTitle = unit.sectionLabel ? (
    <PrintedSectionTitle label={unit.sectionLabel} number={unit.sectionNumber} sectionStyle={actions.controller.content.layout.sectionStyle} />
  ) : null

  return (
    <>
      {unit.sectionId && actions.textEditable && EditorSection ? (
        <EditorSection controller={actions.controller} number={unit.sectionNumber} section={actions.controller.content.sections.find((section) => section.id === unit.sectionId)!} />
      ) : (
        printedTitle
      )}
      {unit.groupLabel ? (
        <p className="font-bold text-muted-foreground uppercase" style={{ fontSize: "0.9em", lineHeight: 13 / 9, marginBottom: printedSpace(8) }}>
          {unit.groupLabel}
        </p>
      ) : null}
      {cue ? (
        // While the page is built, each branch starts with its rule, as a blank form prints it.
        <p className="text-muted-foreground" data-slot="branch-cue" style={{ fontSize: "0.9em", lineHeight: 12 / 9, marginBottom: printedSpace(4) }}>
          {cue}
        </p>
      ) : null}
      <div
        className="relative grid"
        data-cell-row={unit.columns > 1 && !actions.narrow ? "" : undefined}
        data-line-row={actions.fieldStyle === "line" && unit.columns > 1 && !actions.narrow && unit.blocks.every(({ block }) => isBoxed(block)) ? "" : undefined}
        // A row stacks on a phone, where there is no room beside a block.
        // Each block keeps the space the PDF leaves under it, so rows need no gap of their own.
        style={{
          columnGap: actions.fieldStyle === "cell" && unit.blocks.every(({ block }) => isBoxed(block)) ? 0 : "var(--doc-column-gap)",
          gridTemplateColumns: actions.narrow ? undefined : rowGridColumns(unit.columns, unit.widths),
          // A block moved across the page sits where it was put.
          ...(unit.frame && !actions.narrow ? { marginLeft: `${unit.frame.left}%`, width: `${unit.frame.width}%` } : {}),
        }}
      >
        {unit.blocks.map((renderBlock) => (
          <CanvasBlock actions={actions} block={renderBlock.block} key={renderBlock.block.id} listMarkers={renderBlock.listMarkers} />
        ))}
        {actions.textEditable && !actions.narrow ? <RowSeams controller={actions.controller} unit={unit} /> : null}
        {FrameEdges && actions.textEditable && !actions.narrow && unit.columns === 1 && unit.blocks[0] ? (
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

// A row of answers on lines writes on one level: each field's lines end
// together, and its caption and help hang below.
// Cells share their edges, as a printed form's grid does: a row's cells
// overlap by one edge, and so do its lines when it wraps. The space under
// the cells is the unit's, and goes when cells follow. The foot of a boxed
// section's box comes after it (see sectionBoxStyle).
const CELL_JOINS = (
  <style href="paper-cell-joins" precedence="document-fonts">{`
[data-section-box] { padding-bottom: var(--box-foot) }
[data-cell-bottom] [data-block-id] { margin-bottom: -0.07em !important }
[data-cell-bottom] [data-paper-cell] { margin-bottom: 0 !important }
[data-cell-bottom] { padding-bottom: calc(0.07em + 3 * var(--doc-pt) + max(0px, calc(7 * var(--doc-pt) + var(--doc-adjust, 0px))) + var(--box-foot, 0px)) }
[data-cell-bottom]:has(+ [data-cell-top]) { padding-bottom: 0 }
[data-cell-bottom] [data-cell-row] > [data-block-id] + [data-block-id] { margin-left: -0.07em }
[data-line-row] > [data-block-id] { display: grid; grid-row: span 2; grid-template-rows: subgrid }
[data-line-row] > [data-block-id] > [data-paper-line] { display: grid; grid-row: span 2; grid-template-rows: subgrid }
[data-line-row] [data-paper-line] > :first-child { align-self: end }
`}</style>
)

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

// Margin words sit on a line this many ems tall, their baseline this far down it.
const WORDS_LINE_EM = 1.3
const WORDS_ASCENT_EM = 1

// Words in a margin, each in its third of the line and cut short where they
// would run into the next, as the PDF prints them.
// Each slot runs as far as its neighbours let it, as the PDF fits them
// (fitMarginWords): a centred word keeps to a third and the sides share the
// rest; otherwise the shorter side keeps its words and the longer takes what
// is left, so a long title runs up to the page count.
function MarginWords({
  className,
  style,
  words,
}: {
  className?: string
  style?: CSSProperties
  words: TemplateMarginWords
}): ReactElement | null {
  if (!words.left && !words.center && !words.right) {
    return null
  }

  const centred = Boolean(words.center)
  const keeps = (words.left ?? "").length <= (words.right ?? "").length ? "left" : "right"
  const side = (slot: "left" | "right") =>
    cn("min-w-0 truncate", slot === "right" && "text-right", !centred && keeps === slot && "max-w-[calc(50%-0.375rem)] shrink-0")

  return (
    <div
      className={cn(
        "pointer-events-none gap-3 text-muted-foreground tabular-nums",
        centred ? "grid grid-cols-[1fr_fit-content(33.333%)_1fr]" : "flex justify-between",
        className
      )}
      data-slot="margin-words"
      style={{ lineHeight: WORDS_LINE_EM, ...style }}
    >
      <span className={side("left")}>{words.left}</span>
      {centred ? <span className="min-w-0 truncate text-center">{words.center}</span> : null}
      <span className={side("right")}>{words.right}</span>
    </div>
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

    // Lines rarely sit on whole pixels, so a break rounds onto the line it
    // starts, never back into the one above, which would follow it over.
    const offsets = rest.map((lineTop) => (lineTop - (first ?? lineTop)) / zoom).filter((offset) => offset >= 1)

    for (const line of new Set(offsets.map((offset) => Math.ceil(offset)))) {
      rows.push({ key: `${paragraph.dataset.lineKey}@${line}`, top: top + line })
    }
  }

  return rows.sort((one, other) => one.top - other.top)
}

// Blocks get their right-click menu only while they can be chosen; a page
// that is only read or filled in has none.
function Selectable({ actions, children }: { actions: CanvasActions; children: ReactNode }): ReactNode {
  const BlockContextMenu = useDesignTools()?.BlockContextMenu

  return (actions.textEditable || actions.designable) && BlockContextMenu ? (
    <BlockContextMenu actions={actions}>{children}</BlockContextMenu>
  ) : (
    children
  )
}
