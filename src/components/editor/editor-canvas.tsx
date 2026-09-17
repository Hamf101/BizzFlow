"use client"

import { Plus } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
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
import { placeCaret, type TextCaret } from "@/components/editor/editable-text"
import {
  CanvasBlock,
  type CanvasActions,
  isLine,
  isList,
  type LineBlock,
  type ListBlock,
} from "@/components/editor/editor-block"
import {
  convertTextBlock,
  mergeIntoPrevious,
  readMarkdownShortcut,
  splitTextBlock,
} from "@/components/editor/editor-content"
import { paginate, type PageFrame } from "@/components/editor/editor-pagination"
import { SlashMenu } from "@/components/editor/slash-menu"
import type { EditorController } from "@/components/editor/use-editor-controller"
import { resolveDocumentSurfaceInk, type DocumentSurface } from "@/lib/document-surface"
import { cn } from "@/lib/utils"
import {
  createTemplateRenderPlan,
  shouldRenderTemplateFooter,
  shouldRenderTemplateHeader,
  type TemplateRenderBlock,
  type TemplateRenderPlan,
} from "@/services/templates/template-render-plan"
import type { TemplateBlock } from "@/types/template"
import {
  deleteTemplateBlock,
  insertTemplateBlock,
  updateTemplateBlock,
} from "@/types/template-structure"

/** CSS pixels in a printed point: a page at 100% is its paper's real size. */
export const POINT_PX = 4 / 3
// A phone shows the words reflowed at a size that reads comfortably.
const PHONE_POINT_PX = 1.5
const PAGE_GAP_PX = 36
const FOOTER_POINTS = 18
const EMPTY_ANSWERS: Record<string, unknown> = {}
const TEXT_CHOICE = INSERT_CHOICES[0] as InsertChoice

type CanvasUnit = Readonly<{
  blocks: readonly TemplateRenderBlock[]
  columns: 1 | 2
  groupLabel: string | null
  id: string
  keepWithNext: boolean
  pageBreakBefore: boolean
  sectionLabel: string | null
}>

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
  const ink = resolveDocumentSurfaceInk(surface, plan.branding)
  const point = narrow ? PHONE_POINT_PX : POINT_PX * plan.geometry.scale
  const pageWidth = plan.geometry.widthPoints * point
  const pageHeight = plan.geometry.heightPoints * point
  const margin = plan.geometry.marginPoints * point
  const blockGap = { balanced: 11, comfortable: 16, compact: 7 }[plan.layout.density] * point
  const hasBranding = Boolean(plan.branding.logoDataUrl || plan.branding.organizationName)
  const rootRef = useRef<HTMLDivElement>(null)
  const unitElements = useRef(new Map<string, HTMLElement>())
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [layout, setLayout] = useState<ReturnType<typeof paginate>>({ pageCount: 1, pages: {}, spacers: {} })
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
    marginBottom: (page) => margin + (footerOn(page) ? FOOTER_POINTS * point : 0),
    marginTop: (page) => margin + (headerOn(page) ? headerHeight : 0),
  }

  useEffect(() => {
    void document.fonts?.ready.then(() => setFontsReady((count) => count + 1))
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

    const next = paginate(
      units.map((unit) => ({
        height: unitElements.current.get(unit.id)?.offsetHeight ?? 0,
        id: unit.id,
        keepWithNext: unit.keepWithNext,
        pageBreakBefore: unit.pageBreakBefore,
      })),
      frame
    )

    if (JSON.stringify(next) !== JSON.stringify(layout)) {
      setLayout(next)
    }
  })

  useEffect(() => {
    const focus = controller.focus

    if (!focus) {
      return
    }

    const key = focus.item === undefined ? focus.blockId : `${focus.blockId}:${focus.item}`
    const element = rootRef.current?.querySelector<HTMLElement>(
      `[data-caret-key="${key}"]`
    )

    if (element) {
      placeCaret(element, focus.offset)
    }
  }, [controller.focus])

  function blockText(blockId: string, item?: number): string {
    const key = item === undefined ? blockId : `${blockId}:${item}`

    return (
      rootRef.current?.querySelector<HTMLElement>(`[data-caret-key="${key}"]`)
        ?.textContent ?? ""
    )
  }

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

    const text = blockText(block.id)
    const rest = text.slice(0, open.start) + text.slice(open.start + 1 + open.query.length)

    if (choice.action.kind === "text") {
      const kind = choice.action.value
      const list = kind.type === "bullet_list" || kind.type === "numbered_list"

      controller.change((current) => convertTextBlock(current, block.id, kind, rest).content)
      controller.requestFocus({ blockId: block.id, item: list ? 0 : undefined, offset: open.start })
      return
    }

    controller.updateBlock({ ...block, text: rest })
    controller.insert(
      choice,
      rest.trim().length === 0 ? { replaceBlockId: block.id } : { afterBlockId: block.id }
    )
  }

  function focusNeighbour(blockId: string, direction: -1 | 1): boolean {
    const blocks = content.blocks
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

  function handleSlashKey(event: KeyboardEvent<HTMLElement>, blockId: string): boolean {
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
    onAnswerChange,
    onLineInput(block: LineBlock, text: string, caret: number): void {
      const shortcut = block.type === "paragraph" ? readMarkdownShortcut(text) : null

      if (shortcut) {
        const list = shortcut.type === "bullet_list" || shortcut.type === "numbered_list"

        setSlash(null)
        controller.change((current) => convertTextBlock(current, block.id, shortcut, "").content)
        controller.requestFocus({ blockId: block.id, item: list ? 0 : undefined, offset: 0 })
        return
      }

      controller.updateBlock({ ...block, text }, `text:${block.id}`)
      updateSlash(block.id, text, caret)
    },
    onLineKeyDown(event: KeyboardEvent<HTMLElement>, caret: TextCaret, block: LineBlock): void {
      if (handleSlashKey(event, block.id) || event.nativeEvent.isComposing) {
        return
      }

      const synced = { ...block, text: caret.text }
      const mod = event.metaKey || event.ctrlKey

      if (event.key === "Enter") {
        event.preventDefault()
        const id = crypto.randomUUID()
        const opensAbove = caret.offset === 0 && caret.text.length > 0

        controller.change((current) =>
          splitTextBlock(updateTemplateBlock(current, synced), block.id, caret.offset, id).content
        )
        controller.requestFocus(opensAbove ? { blockId: block.id, offset: 0 } : { blockId: id, offset: 0 })
      } else if (event.key === "Backspace" && caret.atStart && caret.collapsed) {
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
    onListInput(block: ListBlock, item: number, text: string): void {
      controller.updateBlock(
        { ...block, items: block.items.map((value, index) => (index === item ? text : value)) },
        `list:${block.id}:${item}`
      )
    },
    onListKeyDown(event: KeyboardEvent<HTMLElement>, caret: TextCaret, block: ListBlock, item: number): void {
      if (event.nativeEvent.isComposing) {
        return
      }

      const items = block.items.map((value, index) => (index === item ? caret.text : value))

      if (event.key === "Enter") {
        event.preventDefault()

        if (caret.text.length === 0) {
          endList(block, items, item)
          return
        }

        const next = [
          ...items.slice(0, item),
          caret.text.slice(0, caret.offset),
          caret.text.slice(caret.offset),
          ...items.slice(item + 1),
        ]

        controller.change((current) => updateTemplateBlock(current, { ...block, items: next }))
        controller.requestFocus({ blockId: block.id, item: item + 1, offset: 0 })
      } else if (event.key === "Backspace" && caret.atStart && caret.collapsed) {
        event.preventDefault()

        if (item > 0) {
          const previous = items[item - 1] ?? ""
          const merged = [...items.slice(0, item - 1), previous + caret.text, ...items.slice(item + 1)]

          controller.change((current) => updateTemplateBlock(current, { ...block, items: merged }))
          controller.requestFocus({ blockId: block.id, item: item - 1, offset: previous.length })
          return
        }

        leaveList(block, items)
      } else if (event.key === "ArrowUp" && caret.atStart) {
        event.preventDefault()

        if (item > 0) {
          controller.requestFocus({ blockId: block.id, item: item - 1, offset: items[item - 1]?.length ?? 0 })
        } else {
          focusNeighbour(block.id, -1)
        }
      } else if (event.key === "ArrowDown" && caret.atEnd) {
        event.preventDefault()

        if (item < items.length - 1) {
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

  // An empty item ends a list: what follows it becomes a line of text.
  function endList(block: ListBlock, items: readonly string[], item: number): void {
    const before = items.slice(0, item)
    const after = items.slice(item + 1)
    const line: TemplateBlock = { alignment: "left", id: crypto.randomUUID(), text: "", type: "paragraph" }
    const index = content.blocks.findIndex((candidate) => candidate.id === block.id)
    const previousId = content.blocks[index - 1]?.id ?? null

    controller.change((current) => {
      if (before.length === 0 && after.length === 0) {
        return insertTemplateBlock(deleteTemplateBlock(current, block.id), previousId, line)
      }

      if (before.length === 0) {
        return insertTemplateBlock(updateTemplateBlock(current, { ...block, items: after }), previousId, line)
      }

      const kept = insertTemplateBlock(updateTemplateBlock(current, { ...block, items: before }), block.id, line)

      return after.length === 0
        ? kept
        : insertTemplateBlock(kept, line.id, { id: crypto.randomUUID(), items: after, type: block.type })
    })
    controller.requestFocus({ blockId: line.id, offset: 0 })
  }

  // Backspace at the start of a list's first item lifts it out as a line.
  function leaveList(block: ListBlock, items: readonly string[]): void {
    const [first = "", ...rest] = items

    if (rest.length === 0) {
      controller.change((current) => convertTextBlock(current, block.id, { type: "paragraph" }, first).content)
      controller.requestFocus({ blockId: block.id, offset: 0 })
      return
    }

    const index = content.blocks.findIndex((candidate) => candidate.id === block.id)
    const line: TemplateBlock = { alignment: "left", id: crypto.randomUUID(), text: first, type: "paragraph" }

    controller.change((current) =>
      insertTemplateBlock(
        updateTemplateBlock(current, { ...block, items: rest }),
        content.blocks[index - 1]?.id ?? null,
        line
      )
    )
    controller.requestFocus({ blockId: line.id, offset: 0 })
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
        className="mx-auto w-full max-w-2xl bg-card px-5 py-6 shadow-sm"
        data-document-surface={surface}
        data-slot="editor-pages"
        ref={rootRef}
        style={inkStyle}
      >
        {flow}
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

  const stackHeight = layout.pageCount * (pageHeight + PAGE_GAP_PX) + (textEditable ? 56 : 0)

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
        {Array.from({ length: layout.pageCount }, (_, page) => (
          <div
            aria-label={`Page ${page + 1} of ${layout.pageCount}`}
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
            {headerOn(page) ? (
              <div
                className={cn(
                  "absolute inset-x-0 flex flex-col gap-[0.3em]",
                  plan.branding.logoAlignment === "center" && "items-center",
                  plan.branding.logoAlignment === "right" && "items-end"
                )}
                ref={page === 0 ? headerRef : undefined}
                style={{ paddingBottom: 10 * point, paddingInline: margin, top: margin }}
              >
                {plan.branding.logoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a data URL the author uploaded
                  <img
                    alt={`${plan.branding.organizationName || "Organization"} logo`}
                    src={plan.branding.logoDataUrl}
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
                zone={{ height: margin, top: 0 }}
              />
            ) : null}
            {footerOn(page) ? (
              <p
                className="absolute text-muted-foreground tabular-nums"
                style={{ bottom: margin * 0.55, fontSize: 8 * point, right: margin }}
              >
                Page {page + 1} of {layout.pageCount}
              </p>
            ) : textEditable ? (
              <MarginPill
                label="Page numbers"
                onClick={() =>
                  controller.setLayout({ ...plan.layout, footerPolicy: "all_pages", pageNumbering: "page_x_of_y" })
                }
                zone={{ bottom: 0, height: margin }}
              />
            ) : null}
            {textEditable ? (
              <AddPageButton
                className={cn(
                  "absolute left-1/2 -translate-x-1/2 -translate-y-1/2",
                  page < layout.pageCount - 1 &&
                    "opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover/page:opacity-100"
                )}
                onClick={() => {
                  const lastUnit = units.filter((unit) => (layout.pages[unit.id] ?? 0) <= page).at(-1)

                  controller.addPage(lastUnit?.blocks.at(-1)?.block.id ?? null)
                }}
                style={{ top: pageHeight + (page < layout.pageCount - 1 ? PAGE_GAP_PX / 2 : 28) }}
              />
            ) : null}
          </div>
        ))}
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          data-slot="page-flow"
          style={{ paddingInline: margin, paddingTop: frame.marginTop(0) }}
        >
          {flow}
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
      {unit.sectionLabel ? (
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

function createUnits(plan: TemplateRenderPlan): CanvasUnit[] {
  const units: CanvasUnit[] = []
  const blocks = plan.blocks

  if (plan.title) {
    units.push({ blocks: [], columns: 1, groupLabel: null, id: "title", keepWithNext: false, pageBreakBefore: false, sectionLabel: null })
  }

  let index = 0

  while (index < blocks.length) {
    const first = blocks[index] as TemplateRenderBlock
    const prior = blocks[index - 1]
    const startsSection = index === 0 || prior?.sectionId !== first.sectionId
    const startsGroup = first.fieldGroupId !== null && prior?.fieldGroupId !== first.fieldGroupId
    const grouped: TemplateRenderBlock[] = [first]

    if (first.fieldGroupId !== null && first.fieldGroupColumns === 2) {
      while (blocks[index + grouped.length]?.fieldGroupId === first.fieldGroupId) {
        grouped.push(blocks[index + grouped.length] as TemplateRenderBlock)
      }
    }

    units.push({
      blocks: grouped,
      columns: grouped.length > 1 ? 2 : 1,
      groupLabel: startsGroup ? first.fieldGroupLabel : null,
      id: first.block.id,
      keepWithNext: grouped.at(-1)?.keepWithNext ?? false,
      pageBreakBefore: first.pageBreakBefore,
      sectionLabel: startsSection ? first.sectionLabel : null,
    })
    index += grouped.length
  }

  return units
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

