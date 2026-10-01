"use client"

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Asterisk,
  BringToFront,
  ChevronDown,
  Copy,
  GripVertical,
  Link2,
  Rows2,
  Section,
  Settings2,
  Trash2,
  Undo2,
  WrapText,
} from "lucide-react"
import {
  createContext,
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
  useState,
} from "react"

import type { Editor } from "@tiptap/core"

import { INSERT_CHOICES } from "@/components/editor/block-catalog"
import type { TextCaret } from "@/components/editor/editable-text"
import { convertTextBlock, type TextBlockKind } from "@/components/editor/editor-content"
import { EditorImage } from "@/components/editor/editor-image"
import { EditorTable } from "@/components/editor/editor-table"
import { PaperField, PRINTED_HEADING, printedSpace } from "@/components/editor/paper-field"
import { placeImage, placementOf, SNAP_PX } from "@/components/editor/image-placement"
import { RichLine } from "@/components/editor/rich-line"
import type { EditorController, FocusRequest } from "@/components/editor/use-editor-controller"
import { frameOf, rowOf, setBlockRule } from "@/types/template-structure"
import { RichText } from "@/components/templates/rich-text"
import { FieldGroupSettings } from "@/components/editor/field-group-settings"
import { BlockFields } from "@/components/templates/template-block-editor"
import { TemplateStaticBlock } from "@/components/templates/template-static-block"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { answerBoxHeight, BOX_HEIGHT_POINTS, type TemplateBlock, type TextRun } from "@/types/template"

export type LineBlock = Extract<TemplateBlock, { type: "heading" | "paragraph" }>
export type ListBlock = Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>
type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>
type ImageBlock = Extract<TemplateBlock, { type: "image" }>
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
/**
 * The space left before each part of a block that starts a new page — a line
 * of a paragraph, a list item, a table row — keyed as the canvas measured it.
 * Empty on a phone, where the writing reflows instead of filling pages.
 */
export const PageBreaks = createContext<Readonly<Record<string, number>>>({})

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

  // Alt and an arrow move a block alone on its line across the page, or
  // down; with Shift, across makes it narrower or wider.
  function nudgeFrame(event: KeyboardEvent<HTMLDivElement>): boolean {
    const content = controller.content
    const inRow = (rowOf(content, block.id)?.columns ?? 1) > 1

    if (actions.narrow || inRow || !(actions.textEditable || actions.designable)) {
      return false
    }

    const rule = content.blockRules.find((candidate) => candidate.blockId === block.id)
    const { left, width } = rule?.frame ?? { left: 0, width: 100 }
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      controller.change((current) => setBlockRule(current, block.id, { spaceAbove: Math.max(0, (rule?.spaceAbove ?? 0) + step * 2) }), `space:${block.id}`)
    } else if (event.shiftKey) {
      controller.change((current) => setBlockRule(current, block.id, { frame: frameOf(left, Math.max(5, width + step)) }), `frame:${block.id}`)
    } else {
      controller.change((current) => setBlockRule(current, block.id, { frame: frameOf(Math.min(Math.max(0, left + step), 100 - width), width) }), `frame:${block.id}`)
    }

    return true
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
    } else if (event.altKey && event.key.startsWith("Arrow") && nudgeFrame(event)) {
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
      {selected && canSelect && actions.dragging !== block.id ? <BlockToolbar actions={actions} block={block} /> : null}
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
export function BlockContextMenu({ actions, children }: { actions: CanvasActions; children: ReactNode }): ReactElement {
  const [blockId, setBlockId] = useState<string | null>(null)
  const target = useRef<string | null>(null)
  const pointer = useRef("")
  const block = actions.controller.content.blocks.find((candidate) => candidate.id === blockId)

  return (
    <ContextMenu
      onOpenChange={(open, details) => {
        const chosen = actions.controller.content.blocks.find((candidate) => candidate.id === target.current)
        const canSelect = chosen && (actions.textEditable || (actions.designable && isField(chosen)))

        // A press and hold on a touch screen picks the block up; its toolbar has the same actions.
        if (open && (!canSelect || pointer.current === "touch")) {
          details.cancel()
        }
      }}
    >
      <ContextMenuTrigger
        className="contents"
        onContextMenuCapture={(event) => {
          target.current = (event.target as Element).closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null
          setBlockId(target.current)
        }}
        onKeyDownCapture={() => {
          pointer.current = "keyboard"
        }}
        onPointerDownCapture={(event) => {
          pointer.current = event.pointerType
        }}
      >
        {children}
      </ContextMenuTrigger>
      {block ? <BlockMenu actions={actions} block={block} /> : null}
    </ContextMenu>
  )
}

// What the block's toolbar does, from a right-click or the menu key.
function BlockMenu({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  const { controller } = actions
  const content = controller.content
  const rule = content.blockRules.find((candidate) => candidate.blockId === block.id)
  const inRow = (rowOf(content, block.id)?.columns ?? 1) > 1
  // A picture placed on a page has no place in the order.
  const pinned = block.type === "image" && block.placement !== undefined

  return (
    <DropdownMenuContent className="w-52">
      {inRow ? (
        <DropdownMenuItem onClick={() => controller.standAlone(block.id)}>
          <Rows2 aria-hidden="true" />
          Stand alone
        </DropdownMenuItem>
      ) : null}
      {pinned ? null : (
        <>
          <DropdownMenuCheckboxItem
            checked={rule?.keepWithNext ?? false}
            disabled={content.blocks.at(-1)?.id === block.id}
            onCheckedChange={(on) => controller.setKeepWithNext(block.id, on)}
          >
            <Link2 aria-hidden="true" />
            Keep with next
          </DropdownMenuCheckboxItem>
          {rule?.frame || rule?.spaceAbove ? (
            <DropdownMenuItem onClick={() => controller.change((current) => setBlockRule(current, block.id, { frame: undefined, spaceAbove: 0 }))}>
              <Undo2 aria-hidden="true" />
              Reset position
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={() => controller.duplicate(block.id)}>
        <Copy aria-hidden="true" />
        Duplicate
      </DropdownMenuItem>
      {pinned ? null : (
        <>
          <DropdownMenuItem disabled={!controller.canMove(block.id, "up")} onClick={() => controller.move(block.id, "up")}>
            <ArrowUp aria-hidden="true" />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!controller.canMove(block.id, "down")} onClick={() => controller.move(block.id, "down")}>
            <ArrowDown aria-hidden="true" />
            Move down
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => controller.remove(block.id)} variant="destructive">
        <Trash2 aria-hidden="true" />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function BlockBody({ actions, block, placed }: { actions: CanvasActions; block: TemplateBlock; placed: boolean }): ReactElement {
  const breaks = useContext(PageBreaks)

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
      return <EditorTable actions={actions} block={block} breaks={breaks} />
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
          mode={actions.fields}
          onAnswerChange={actions.onAnswerChange}
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

  if (!actions.textEditable) {
    // A paragraph reads as one; it is a plain block only while it can be typed in.
    const Element = as === "div" ? "p" : as

    return (
      <Element className={cn("min-w-0 break-words whitespace-pre-wrap", className)} data-line-key={caretKey} style={style}>
        <RichText runs={runs} text={value} />
      </Element>
    )
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
function isBoxed(block: TemplateBlock): block is BoxedField {
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

function BlockToolbar({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  const { controller } = actions
  const blocks = controller.content.blocks
  const index = blocks.findIndex((candidate) => candidate.id === block.id)

  const group = rowOf(controller.content, block.id)
  const inRow = group !== undefined && group.columns > 1
  const keepWithNext = controller.content.blockRules.some((rule) => rule.blockId === block.id && rule.keepWithNext)

  // A picture let out of the text stays exactly where it was on its page.
  function placeFreely(image: ImageBlock): void {
    const picture = document.querySelector(`[data-block-id="${CSS.escape(image.id)}"] [data-image-box]`)
    const placement = (picture ? placementOf(picture) : null) ?? placeImage({ height: 25, page: 1, width: 40, x: 10, y: 10 })

    controller.updateBlock({ ...image, placement })
  }

  function turnInto(kind: TextBlockKind): void {
    const isList = kind.type === "bullet_list" || kind.type === "numbered_list"

    controller.change((current) => convertTextBlock(current, block.id, kind).content)
    controller.requestFocus({ blockId: block.id, item: isList ? 0 : undefined, offset: 0 })
  }

  return (
    <div
      className={cn(
        "absolute bottom-full z-30 mb-[0.8em] flex w-max max-w-[calc(100vw-3rem)] flex-wrap items-center gap-0.5 rounded-[12px] border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg",
        // Rows stack on a phone, so every block there is the column's full width.
        "right-0 justify-end"
      )}
      data-slot="block-toolbar"
      role="toolbar"
      aria-label="Block"
    >
      {isLine(block) || isList(block) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button className="h-10 gap-1 px-2 font-normal md:pointer-fine:h-8" size="sm" type="button" variant="ghost">
                {describeLine(block)}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            {isLine(block) ? <DropdownMenuItem disabled={block.text.trim().length > 160 || controller.content.sections.some((section) => section.startBlockId === block.id)} onClick={() => controller.turnIntoSection(block.id)}><Section />Section</DropdownMenuItem> : null}
            {INSERT_CHOICES.filter((choice) => choice.action.kind === "text").map((choice) => {
              const Icon = choice.icon

              return (
                <DropdownMenuItem
                  key={choice.id}
                  onClick={() => choice.action.kind === "text" && turnInto(choice.action.value)}
                >
                  <Icon aria-hidden="true" />
                  {choice.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {isLine(block) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button aria-label="Align" className="size-10 md:pointer-fine:size-8" size="icon-sm" title="Align" type="button" variant="ghost">
                {block.alignment === "center" ? <AlignCenter /> : block.alignment === "right" ? <AlignRight /> : <AlignLeft />}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-36">
            {(["left", "center", "right"] as const).map((alignment) => (
              <DropdownMenuItem
                key={alignment}
                onClick={() => controller.updateBlock({ ...block, alignment })}
              >
                {alignment === "center" ? <AlignCenter /> : alignment === "right" ? <AlignRight /> : <AlignLeft />}
                {alignment[0]?.toUpperCase() + alignment.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {inRow ? (
        <ToolButton label="Stand alone" onClick={() => controller.standAlone(block.id)}><Rows2 /></ToolButton>
      ) : null}
      {!(block.type === "image" && block.placement) ? (
        <ToolButton disabled={index === blocks.length - 1} label="Keep with next" onClick={() => controller.setKeepWithNext(block.id, !keepWithNext)} pressed={keepWithNext}><Link2 /></ToolButton>
      ) : null}
      {isField(block) ? (
        <ToolButton
          label={block.required ? "Make optional" : "Make required"}
          onClick={() => controller.updateBlock({ ...block, required: !block.required })}
          pressed={block.required}
        >
          <Asterisk />
        </ToolButton>
      ) : null}
      {isField(block) ? (
        <Popover
          onOpenChange={(open) => (open ? controller.openSettings(block.id) : controller.closeSettings())}
          open={controller.settingsBlockId === block.id}
        >
          <PopoverTrigger
            render={
              <Button aria-label="Field settings" className="size-10 md:pointer-fine:size-8" size="icon-sm" title="Field settings" type="button" variant="ghost">
                <Settings2 />
              </Button>
            }
          />
          <PopoverContent className="w-80">
            <PopoverTitle className="mb-3 font-semibold">Field settings</PopoverTitle>
            <BlockFields block={block} blocks={blocks} onChange={(next) => controller.updateBlock(next, `settings:${block.id}`)} />
            {group ? <FieldGroupSettings controller={controller} group={group} /> : null}
          </PopoverContent>
        </Popover>
      ) : null}
      {block.type === "image" ? (
        <>
          {/* A phone's column has no pages to place a picture on, only a way back into the text. */}
          {block.placement || !actions.narrow ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button className="h-10 gap-1 px-2 font-normal md:pointer-fine:h-8" size="sm" type="button" variant="ghost">
                    {block.placement ? "In front of text" : "In line"}
                    <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => controller.updateBlock({ ...block, placement: undefined })}>
                  <WrapText aria-hidden="true" />
                  In line
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => !block.placement && placeFreely(block)}>
                  <BringToFront aria-hidden="true" />
                  In front of text
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <ToolButton label="Settings" onClick={() => controller.openSettings(block.id)}>
            <Settings2 />
          </ToolButton>
        </>
      ) : null}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <ToolButton label="Duplicate" onClick={() => controller.duplicate(block.id)}>
        <Copy />
      </ToolButton>
      {/* A picture placed on a page has no place in the order to move to. */}
      {block.type === "image" && block.placement ? null : (
        <>
          <ToolButton
            disabled={!controller.canMove(block.id, "up")}
            keys="Control+Shift+ArrowUp Meta+Shift+ArrowUp"
            label="Move up"
            onClick={() => controller.move(block.id, "up")}
          >
            <ArrowUp />
          </ToolButton>
          <ToolButton
            disabled={!controller.canMove(block.id, "down")}
            keys="Control+Shift+ArrowDown Meta+Shift+ArrowDown"
            label="Move down"
            onClick={() => controller.move(block.id, "down")}
          >
            <ArrowDown />
          </ToolButton>
        </>
      )}
      <ToolButton label="Delete" onClick={() => controller.remove(block.id)}>
        <Trash2 />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  children,
  disabled,
  keys,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  disabled?: boolean
  /** The keys that do the same, for screen readers. */
  keys?: string
  label: string
  onClick: () => void
  pressed?: boolean
}): ReactElement {
  return (
    <Button
      aria-keyshortcuts={keys}
      aria-label={label}
      aria-pressed={pressed}
      className={cn("size-10 md:pointer-fine:size-8", pressed && "bg-secondary text-secondary-foreground")}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
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
      className="absolute top-0 -right-5 hidden h-[1.5em] w-5 touch-none place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:grid"
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

function describeLine(block: LineBlock | ListBlock): string {
  switch (block.type) {
    case "heading":
      return `Heading ${block.level}`
    case "paragraph":
      return "Text"
    case "bullet_list":
      return "Bulleted list"
    case "numbered_list":
      return "Numbered list"
  }
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

function isField(block: TemplateBlock): block is FieldBlock {
  return "fieldKey" in block
}
