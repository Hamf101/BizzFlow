"use client"

import { GripVertical } from "lucide-react"
import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react"

import type { Editor } from "@tiptap/core"

import { useDesignTools } from "@/components/editor/design-tools"
import type { TextCaret } from "@/components/editor/editable-text"
import { EditorImage } from "@/components/editor/editor-image"
import { PageBreaks, readOnlyCell, TableCells } from "@/components/editor/table-cells"
import { PaperField, PRINTED_HEADING, printedSpace } from "@/components/editor/paper-field"
import { placeImage, SNAP_PX } from "@/components/editor/image-placement"
import type { EditorController, FocusRequest } from "@/components/editor/use-editor-controller"
import { RichText } from "@/components/templates/rich-text"
import { TemplateStaticBlock } from "@/components/templates/template-static-block"
import { cn } from "@/lib/utils"
import { type TemplateBlock, type TemplateLayout, type TextRun } from "@/types/template"
import { answerBoxHeight, BOX_HEIGHT_POINTS } from "@/types/template-limits"

export type LineBlock = Extract<TemplateBlock, { type: "heading" | "paragraph" }>
export type ListBlock = Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>
export type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>
export type ImageBlock = Extract<TemplateBlock, { type: "image" }>
type Placement = NonNullable<ImageBlock["placement"]>

/** What the canvas lends each block: its controller, modes, and key handling. */
export type CanvasActions = Readonly<{
  answers: Record<string, unknown>
  controller: EditorController
  designable: boolean
  /** The block being dragged to a new place, if any. */
  dragging: string | null
  fields: "design" | "fill" | "read"
  /** Blocks the answers so far would hide, shown faded while the page is built. */
  hiddenByRule: ReadonlySet<string>
  /** How the document draws its answers: in a box, on a line, or in a cell. */
  fieldStyle: NonNullable<TemplateLayout["fieldStyle"]>
  /** Whether the page is a phone's reflowed column rather than sheets of paper. */
  narrow: boolean
  /** The caret request for one line, when it is that line's turn. */
  focusFor: (caretKey: string) => FocusRequest | null
  onAnswerChange: (fieldKey: string, value: unknown) => void
  onLineInput: (block: LineBlock, text: string, runs: TextRun[] | undefined, caret: number) => void
  onLineKeyDown: (event: globalThis.KeyboardEvent, caret: TextCaret, block: LineBlock) => void
  /** Puts words pasted over several lines in a line, from one place to another, as a line each. */
  onPasteLines: (caretKey: string, lines: readonly string[], from: number, to: number) => void
  onListInput: (block: ListBlock, item: number, text: string, runs: TextRun[] | undefined) => void
  onListKeyDown: (event: globalThis.KeyboardEvent, caret: TextCaret, block: ListBlock, item: number) => void
  placeholderFor: (blockId: string) => string | undefined
  /** What a page that takes uploads puts in a file field while it is filled in. */
  renderFileField?: (block: Extract<TemplateBlock, { type: "file_field" }>) => ReactNode
  /** Starts dragging a block, from a press on it or on its grip; absent where blocks cannot move. */
  startDrag?: (event: PointerEvent<HTMLElement>, blockId: string, grip?: boolean) => void
  textEditable: boolean
}>

// Headings at the PDF's sizes and lines: 20 points on 29, 16 on 24, 13 on 20.
// A phone's reflowed column is narrow, so its headings step down less steeply.
const HEADING_STYLE = {
  1: { ...PRINTED_HEADING, fontSize: "var(--doc-h1, 2em)", lineHeight: `var(--doc-line-height, ${29 / 20})` },
  2: { ...PRINTED_HEADING, fontSize: "var(--doc-h2, 1.6em)", lineHeight: `var(--doc-line-height, ${24 / 16})` },
  3: { ...PRINTED_HEADING, fontSize: "var(--doc-h3, 1.3em)", lineHeight: `var(--doc-line-height, ${20 / 13})` },
} as const

// The points the PDF leaves above and below each kind of block (see
// drawPdfLibBlock); a field leaves 3 under its box, inside it, and 7 more.
const PRINTED_SPACE: Partial<Record<TemplateBlock["type"], readonly [above: number, below: number]>> = {
  bullet_list: [0, 5],
  divider: [6, 14],
  heading: [10, 6],
  image: [0, 4],
  numbered_list: [0, 5],
  paragraph: [0, 8],
  table: [0, 10],
}

function printedMargins(block: TemplateBlock): CSSProperties {
  const [above, below] = PRINTED_SPACE[block.type] ?? [0, 7]

  return { marginBottom: printedSpace(below), marginTop: above ? printedSpace(above, false) : undefined }
}

/**
 * One block on the page. Text is typed in place; anything else is selected by
 * clicking it, then acted on from the toolbar above it or the keyboard.
 *
 * @param props - The block and what the canvas lends it.
 * @returns The block, with its toolbar while selected.
 */
export { PageBreaks }

/**
 * Folds every one of those spaces away while the canvas measures, so each
 * block reports its own height rather than the last layout's.
 */
export const PAGE_BREAKS_FOLDED = { "--page-space-display": "none", "--page-space-scale": "0" } as const

export function CanvasBlock({
  actions,
  block,
  placed = false,
}: {
  actions: CanvasActions
  block: TemplateBlock
  /** Whether it is a picture drawn in its box on a page rather than in the text. */
  placed?: boolean
}): ReactElement {
  const { controller } = actions
  const selected = controller.selectedBlockId === block.id
  const wrapper = useRef<HTMLDivElement>(null)
  const field = isField(block)
  const text = isLine(block) || isList(block)
  const canSelect = actions.textEditable || (actions.designable && field)
  const tools = useDesignTools()

  useEffect(() => {
    if (selected) {
      wrapper.current?.focus({ preventScroll: true })
    }
  }, [selected])

  function handleMouseDown(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement

    if (
      !canSelect ||
      target.closest("input, textarea, select, button, canvas, a, label, [contenteditable], [data-slot=block-toolbar]")
    ) {
      return
    }

    controller.select(block.id)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
      return
    }

    const mod = event.metaKey || event.ctrlKey
    const blocks = controller.content.blocks
    const index = blocks.findIndex((candidate) => candidate.id === block.id)
    const nudged = placed && block.type === "image" && block.placement ? nudge(block.placement, event) : null

    if (nudged && block.type === "image") {
      event.preventDefault()
      controller.updateBlock({ ...block, placement: nudged }, `image:${block.id}`)
    } else if (
      event.altKey &&
      event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      isBoxed(block) &&
      (actions.textEditable || actions.designable)
    ) {
      // With Shift, up and down make an answer box shorter or taller.
      event.preventDefault()
      controller.updateBlock(sizedBox(block, answerBoxHeight(block) + (event.key === "ArrowUp" ? -2 : 2)), `box:${block.id}`)
    } else if (event.altKey &&
      event.key.startsWith("Arrow") &&
      !actions.narrow &&
      (actions.textEditable || actions.designable) &&
      (tools?.nudgeFrame(controller, block.id, event) ?? false)) {
      event.preventDefault()
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault()
      controller.remove(block.id)
    } else if (event.key === "Escape") {
      event.preventDefault()
      controller.select(null)
    } else if (event.key === "Enter") {
      event.preventDefault()

      if (isLine(block)) {
        controller.requestFocus({ blockId: block.id, offset: block.text.length })
      } else if (isList(block)) {
        const item = block.items.length - 1
        controller.requestFocus({ blockId: block.id, item, offset: block.items[item]?.length ?? 0 })
      } else if (block.type === "table") {
        // A table has no settings of its own; Enter starts typing in it.
        wrapper.current?.querySelector<HTMLElement>("[contenteditable]")?.focus()
      } else if (actions.designable || actions.textEditable) {
        controller.openSettings(block.id)
      }
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && mod && event.shiftKey) {
      event.preventDefault()
      controller.move(block.id, event.key === "ArrowUp" ? "up" : "down")
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const neighbour = blocks[index + (event.key === "ArrowUp" ? -1 : 1)]

      if (neighbour) {
        event.preventDefault()
        controller.select(neighbour.id)
      }
    } else if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault()
      controller.duplicate(block.id)
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      // The menu key opens the block's menu at its corner, as a right-click would.
      const box = event.currentTarget.getBoundingClientRect()

      event.preventDefault()
      event.currentTarget.dispatchEvent(new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 8, clientY: box.top + 8 }))
    }
  }

  return (
    <div
      className={cn(
        "rounded-[0.35em] outline-none",
        placed ? "pointer-events-auto absolute" : "relative",
        canSelect && field && actions.fields === "design" && "cursor-default",
        selected && actions.dragging !== block.id && "ring-2 ring-primary ring-offset-[0.4em] ring-offset-card",
        // Words held still are ready to drag; a block being dragged rides above the page.
        "data-held:ring-2 data-held:ring-primary/40 data-held:ring-offset-[0.4em] data-held:ring-offset-card",
        actions.dragging === block.id && "z-40 bg-card opacity-70 shadow-xl",
        // Hidden by its rule for these answers: there to edit, faded as it won't print.
        actions.hiddenByRule.has(block.id) && "opacity-45"
      )}
      data-block-id={block.id}
      data-block-type={block.type}
      data-hidden-by-rule={actions.hiddenByRule.has(block.id) ? "" : undefined}
      title={actions.hiddenByRule.has(block.id) ? "Hidden for these answers by its rule" : undefined}
      data-selected={selected || undefined}
      // Typing in its words or cells again, the block is no longer chosen as a whole.
      onFocus={(event) => {
        if (selected && event.target !== event.currentTarget && event.target.closest('[contenteditable]:not([contenteditable="false"])')) {
          controller.select(null)
        }
      }}
      onKeyDown={handleKeyDown}
      // Words being typed in keep the browser's own menu, with its spelling and pasting.
      onContextMenuCapture={(event) => {
        if (!selected && (event.target as Element).closest("[data-line-key]")) event.stopPropagation()
      }}
      onMouseDown={handleMouseDown}
      // A picture placed on a page moves on its page instead.
      onPointerDown={placed ? undefined : (event) => actions.startDrag?.(event, block.id)}
      ref={wrapper}
      style={placed && block.type === "image" && block.placement ? boxStyle(block.placement) : printedMargins(block)}
      tabIndex={selected ? -1 : undefined}
    >
      {selected && canSelect && actions.dragging !== block.id && tools ? <tools.BlockToolbar actions={actions} block={block} /> : null}
      {/* On a touch screen the block in use shows a grip beside it: in a row, between the columns. */}
      {!placed && (selected || (text && controller.activeBlockId === block.id)) ? (
        <Grip actions={actions} blockId={block.id} />
      ) : null}
      <BlockBody actions={actions} block={block} placed={placed} />
    </div>
  )
}

/**
 * One menu for every block on the page: a right-click, or the menu key on a
 * chosen block, opens it for the block under it. One for each block made
 * every keystroke redraw hundreds of menus in a long document.
 *
 * @param props - What the canvas does, and the page it covers.
 * @returns The page, with the menu.
 */
function BlockBody({ actions, block, placed }: { actions: CanvasActions; block: TemplateBlock; placed: boolean }): ReactElement {
  const breaks = useContext(PageBreaks)
  const tools = useDesignTools()

  switch (block.type) {
    case "heading":
      return (
        <TextLine
          actions={actions}
          as={`h${block.level}`}
          blockId={block.id}
          caretKey={block.id}
          className="font-bold"
          label={`Heading ${block.level}`}
          onChange={(text, runs, caret) => actions.onLineInput(block, text, runs, caret)}
          onKeyDown={(event, caret) => actions.onLineKeyDown(event, caret, block)}
          placeholder={actions.placeholderFor(block.id) ?? `Heading ${block.level}`}
          runs={block.runs}
          style={{ ...HEADING_STYLE[block.level], color: "var(--doc-primary)", textAlign: block.alignment }}
          value={block.text}
        />
      )
    case "paragraph":
      return (
        <>
          <LineBreaks blockId={block.id} />
          <TextLine
            actions={actions}
            as="div"
            blockId={block.id}
            caretKey={block.id}
            label="Text"
            onChange={(text, runs, caret) => actions.onLineInput(block, text, runs, caret)}
            onKeyDown={(event, caret) => actions.onLineKeyDown(event, caret, block)}
            placeholder={actions.placeholderFor(block.id)}
            runs={block.runs}
            style={{ lineHeight: "var(--doc-line-height, 1.5)", minHeight: "1.5em", textAlign: block.alignment }}
            value={block.text}
          />
        </>
      )
    case "bullet_list":
    case "numbered_list": {
      const List = block.type === "bullet_list" ? "ul" : "ol"

      return (
        <List
          className={cn(block.type === "bullet_list" ? "list-disc" : "list-decimal", "grid gap-[0.3em]")}
          // Each item leaves 3 points under it, as the PDF does.
          style={{ lineHeight: "var(--doc-line-height, 1.5)", paddingBottom: "0.3em", paddingLeft: "1.4em" }}
        >
          {block.items.map((item: string, index: number) => (
            <TextLine
              actions={actions}
              as="li"
              blockId={block.id}
              caretKey={`${block.id}:${index}`}
              key={index}
              label="List item"
              onChange={(text, runs) => actions.onListInput(block, index, text, runs)}
              onKeyDown={(event, caret) => actions.onListKeyDown(event, caret, block, index)}
              placeholder="List item"
              runs={block.itemRuns?.[index] ?? undefined}
              style={spaceBefore(breaks[`${block.id}:${index}`])}
              value={item}
            />
          ))}
        </List>
      )
    }
    case "table":
      // Rows and columns are added and removed only while designing.
      return actions.textEditable && tools ? (
        <tools.EditorTable actions={actions} block={block} breaks={breaks} />
      ) : (
        <TableCells block={block} breaks={breaks} cellProps={readOnlyCell(block.id)} />
      )
    case "image":
      return <EditorImage actions={actions} block={block} placed={placed} />
    case "divider":
      return (
        <TemplateStaticBlock
          accentColorVariable="var(--doc-accent)"
          block={block}
          primaryColorVariable="var(--doc-primary)"
        />
      )
    default:
      return (
        <PaperField
          answers={actions.answers}
          block={block}
          edge={isBoxed(block) && actions.textEditable && !actions.narrow ? <BoxEdge block={block} controller={actions.controller} /> : undefined}
          fieldStyle={actions.fieldStyle}
          mode={actions.fields}
          onAnswerChange={actions.onAnswerChange}
          renderFile={actions.renderFileField}
        />
      )
  }
}

/**
 * A line of words: typed in place with its formatting while text can be
 * edited, and otherwise drawn as it will print. Either way its outer element
 * carries the line's key, which the canvas measures page breaks by.
 *
 * @param props - The line, what it is drawn as, and its handlers.
 * @returns The line.
 */
function TextLine({
  actions,
  as,
  blockId,
  caretKey,
  className,
  label,
  onChange,
  onKeyDown,
  placeholder,
  runs,
  style,
  value,
}: {
  actions: CanvasActions
  as: "div" | "h1" | "h2" | "h3" | "li"
  blockId: string
  caretKey: string
  className?: string
  label: string
  onChange: (text: string, runs: TextRun[] | undefined, caret: number) => void
  onKeyDown: (event: globalThis.KeyboardEvent, caret: TextCaret) => void
  placeholder?: string
  runs?: TextRun[]
  style?: CSSProperties
  value: string
}): ReactElement {
  const { controller } = actions

  // A paragraph reads as one; it is a plain block only while it can be typed
  // in, and reads so until typing has loaded.
  const Element = as === "div" ? "p" : as
  const printed = (
    <Element className={cn("min-w-0 break-words whitespace-pre-wrap", className)} data-line-key={caretKey} style={style}>
      <RichText runs={runs} text={value} />
    </Element>
  )

  const RichLine = useDesignTools()?.RichLine

  if (!actions.textEditable || !RichLine) {
    return printed
  }

  return (
    <RichLine
      as={as}
      caretKey={caretKey}
      className={className}
      focus={actions.focusFor(caretKey)}
      label={label}
      onChange={onChange}
      onFocus={(editor: Editor) => {
        controller.setActiveBlockId(blockId)
        controller.setLine(editor)
      }}
      onGone={(editor: Editor) => controller.setLine((line) => (line === editor ? null : line))}
      onKeyDown={onKeyDown}
      onPasteLines={(lines, from, to) => actions.onPasteLines(caretKey, lines, from, to)}
      placeholder={placeholder}
      runs={runs}
      style={style}
      value={value}
    />
  )
}

function spaceBefore(space: number | undefined): CSSProperties | undefined {
  return space ? { marginTop: `calc(var(--page-space-scale, 1) * ${space}px)` } : undefined
}

/**
 * Moves the lines of a paragraph that start a new page down onto it without
 * touching the text: a zero-width float stands in for the lines above each
 * break, and a full-width one under it is the gap the lines below must clear.
 *
 * @param props - The paragraph.
 * @returns The floats, or nothing when the paragraph sits on one page.
 */
function LineBreaks({ blockId }: { blockId: string }): ReactElement | null {
  const breaks = useContext(PageBreaks)
  const lines = Object.entries(breaks)
    .filter(([key]) => key.startsWith(`${blockId}@`))
    .map(([key, space]) => ({ at: Number(key.slice(blockId.length + 1)), space }))
    .sort((one, other) => one.at - other.at)
  const float = (height: number, width: number | string): CSSProperties => ({
    clear: "left",
    display: "var(--page-space-display, block)",
    float: "left",
    height,
    width,
  })

  return lines.length > 0 ? (
    <>
      {lines.map(({ at, space }, index) => (
        <Fragment key={at}>
          <span aria-hidden="true" style={float(at - (lines[index - 1]?.at ?? 0), 0)} />
          <span aria-hidden="true" style={float(space, "100%")} />
        </Fragment>
      ))}
    </>
  ) : null
}

type BoxedField = Extract<TemplateBlock, { type: "date_field" | "dropdown_field" | "initials_field" | "signature_field" | "text_field" }>

// The fields that print an answer box, whose height can be changed; radio buttons print none.
export function isBoxed(block: TemplateBlock): block is BoxedField {
  return ["date_field", "dropdown_field", "initials_field", "signature_field", "text_field"].includes(block.type) && !(block.type === "dropdown_field" && block.display === "radios")
}

// A box at a height, held between a line and its padding and the most a page
// allows; at its usual height it keeps none of its own.
function sizedBox(block: BoxedField, points: number): BoxedField {
  const sized: BoxedField = { ...block, boxHeight: Math.round(Math.min(Math.max(points, BOX_HEIGHT_POINTS.min), BOX_HEIGHT_POINTS.max)) }

  if (sized.boxHeight === answerBoxHeight({ ...block, boxHeight: undefined })) {
    delete sized.boxHeight
  }

  return sized
}

// The foot of an answer box: dragged, the box grows or shrinks, lining up
// with its usual height and with the other boxes on the page.
function BoxEdge({ block, controller }: { block: BoxedField; controller: EditorController }): ReactElement {
  function drag(event: PointerEvent<HTMLDivElement>): void {
    const box = event.currentTarget.parentElement

    if (!box || !event.currentTarget.hasPointerCapture(event.pointerId)) {
      return
    }

    // The box's text is 10 points, so a tenth of its em is a point on screen.
    const point = parseFloat(getComputedStyle(box).fontSize) / 10
    const top = box.getBoundingClientRect().top
    const heights = [
      answerBoxHeight({ ...block, boxHeight: undefined }),
      ...[...document.querySelectorAll<HTMLElement>("[data-slot=paper-box]")].filter((other) => other !== box).map((other) => other.getBoundingClientRect().height / point),
    ]
    const asked = (event.clientY - top) / point
    const near = heights.reduce((best, height) => (Math.abs(height - asked) < Math.abs(best - asked) ? height : best), Infinity)

    controller.updateBlock(sizedBox(block, Math.abs(near - asked) * point <= SNAP_PX ? near : asked), `box:${block.id}`)
  }

  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-full z-30 h-2.5 cursor-ns-resize touch-none after:absolute after:inset-x-0 after:top-0 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60"
      data-slot="box-edge"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={drag}
    />
  )
}

/**
 * What a finger drags a block by, shown only on a touch screen: a press that
 * travels moves the block, a tap selects it, and the arrow keys move it a
 * step at a time.
 *
 * @param props - The block, and what the canvas lends it.
 * @returns The grip, or nothing where blocks cannot move.
 */
function Grip({ actions, blockId }: { actions: CanvasActions; blockId: string }): ReactElement | null {
  const { controller, startDrag } = actions

  if (!startDrag) {
    return null
  }

  return (
    <button
      aria-keyshortcuts="ArrowUp ArrowDown"
      aria-label="Move"
      className="absolute top-0 -right-5 hidden h-[1.5em] w-5 touch-none place-items-center rounded-md after:absolute after:-inset-x-3 after:-inset-y-3 after:content-[''] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:grid"
      onClick={() => controller.select(blockId)}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault()
          controller.move(blockId, event.key === "ArrowUp" ? "up" : "down")
        }
      }}
      onPointerDown={(event) => startDrag(event, blockId, true)}
      title="Drag to move"
      type="button"
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  )
}

// A picture's box as CSS, in percentages of its page.
function boxStyle(box: Placement): CSSProperties {
  return { height: `${box.height}%`, left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%` }
}

// Where the arrow keys take a placed picture: along the page, a step at a time
// or five with Shift; with Alt, larger or smaller, keeping its shape; and with
// Page Up and Page Down, to the page before or after.
function nudge(box: Placement, event: KeyboardEvent<HTMLElement>): Placement | null {
  const step = event.shiftKey ? 5 : 1
  const [across, down] = { ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step] }[event.key] ?? [0, 0]

  if (event.key === "PageUp" || event.key === "PageDown") {
    return placeImage({ ...box, page: box.page + (event.key === "PageUp" ? -1 : 1) })
  }

  if (!across && !down) {
    return null
  }

  if (event.altKey) {
    const width = Math.max(1, box.width + across + down)

    return placeImage({ ...box, height: (box.height * width) / box.width, width })
  }

  return placeImage({ ...box, x: box.x + across, y: box.y + down })
}

/** Says whether a block is a line of text: a paragraph or a heading. */
export function isLine(block: TemplateBlock | undefined): block is LineBlock {
  return block?.type === "paragraph" || block?.type === "heading"
}

/** Says whether a block is a bulleted or numbered list. */
export function isList(block: TemplateBlock | undefined): block is ListBlock {
  return block?.type === "bullet_list" || block?.type === "numbered_list"
}

/** Says whether a block is a field someone answers. */
export function isField(block: TemplateBlock): block is FieldBlock {
  return "fieldKey" in block
}
