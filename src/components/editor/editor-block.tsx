"use client"

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Asterisk,
  CalendarDays,
  ChevronDown,
  Copy,
  Settings2,
  Trash2,
} from "lucide-react"
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
} from "react"

import { GeneratedBlock } from "@/components/documents/generated-document-content"
import { INSERT_CHOICES } from "@/components/editor/block-catalog"
import { EditableText, type TextCaret } from "@/components/editor/editable-text"
import { convertTextBlock, type TextBlockKind } from "@/components/editor/editor-content"
import type { EditorController } from "@/components/editor/use-editor-controller"
import { TemplateStaticBlock } from "@/components/templates/template-static-block"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { TemplateBlock } from "@/types/template"

export type LineBlock = Extract<TemplateBlock, { type: "heading" | "paragraph" }>
export type ListBlock = Extract<TemplateBlock, { type: "bullet_list" | "numbered_list" }>
type FieldBlock = Extract<TemplateBlock, { fieldKey: string }>

/** What the canvas lends each block: its controller, modes, and key handling. */
export type CanvasActions = Readonly<{
  answers: Record<string, unknown>
  controller: EditorController
  designable: boolean
  fields: "design" | "fill" | "read"
  onAnswerChange: (fieldKey: string, value: unknown) => void
  onLineInput: (block: LineBlock, text: string, caret: number) => void
  onLineKeyDown: (event: KeyboardEvent<HTMLElement>, caret: TextCaret, block: LineBlock) => void
  onListInput: (block: ListBlock, item: number, text: string) => void
  onListKeyDown: (
    event: KeyboardEvent<HTMLElement>,
    caret: TextCaret,
    block: ListBlock,
    item: number
  ) => void
  placeholderFor: (blockId: string) => string | undefined
  textEditable: boolean
}>

// A phone's reflowed column is narrow, so its headings step down less steeply.
const HEADING_STYLE = {
  1: { fontSize: "var(--doc-h1, 2em)", lineHeight: 1.35 },
  2: { fontSize: "var(--doc-h2, 1.6em)", lineHeight: 1.4 },
  3: { fontSize: "var(--doc-h3, 1.3em)", lineHeight: 1.45 },
} as const

/**
 * One block on the page. Text is typed in place; anything else is selected by
 * clicking it, then acted on from the toolbar above it or the keyboard.
 *
 * @param props - The block and what the canvas lends it.
 * @returns The block, with its toolbar while selected.
 */
export function CanvasBlock({
  actions,
  block,
}: {
  actions: CanvasActions
  block: TemplateBlock
}): ReactElement {
  const { controller } = actions
  const selected = controller.selectedBlockId === block.id
  const wrapper = useRef<HTMLDivElement>(null)
  const field = isField(block)
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

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) {
      return
    }

    const mod = event.metaKey || event.ctrlKey
    const blocks = controller.content.blocks
    const index = blocks.findIndex((candidate) => candidate.id === block.id)

    if (event.key === "Backspace" || event.key === "Delete") {
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
    }
  }

  return (
    <div
      className={cn(
        "relative rounded-[0.35em] outline-none",
        canSelect && field && actions.fields === "design" && "cursor-default",
        selected && "ring-2 ring-primary ring-offset-[0.4em] ring-offset-card"
      )}
      data-block-id={block.id}
      data-block-type={block.type}
      data-selected={selected || undefined}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      ref={wrapper}
      tabIndex={selected ? -1 : undefined}
    >
      {selected && canSelect ? <BlockToolbar actions={actions} block={block} /> : null}
      <BlockBody actions={actions} block={block} />
    </div>
  )
}

function BlockBody({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  switch (block.type) {
    case "heading":
      return (
        <EditableText
          as={`h${block.level}`}
          caretKey={block.id}
          className="font-semibold"
          editable={actions.textEditable}
          label={`Heading ${block.level}`}
          onChange={(text, caret) => actions.onLineInput(block, text, caret)}
          onFocus={() => actions.controller.setActiveBlockId(block.id)}
          onKeyDown={(event, caret) => actions.onLineKeyDown(event, caret, block)}
          placeholder={actions.placeholderFor(block.id) ?? `Heading ${block.level}`}
          style={{ ...HEADING_STYLE[block.level], color: "var(--doc-primary)", textAlign: block.alignment }}
          value={block.text}
        />
      )
    case "paragraph":
      return (
        <EditableText
          as="p"
          caretKey={block.id}
          editable={actions.textEditable}
          label="Text"
          onChange={(text, caret) => actions.onLineInput(block, text, caret)}
          onFocus={() => actions.controller.setActiveBlockId(block.id)}
          onKeyDown={(event, caret) => actions.onLineKeyDown(event, caret, block)}
          placeholder={actions.placeholderFor(block.id)}
          style={{ lineHeight: 1.5, minHeight: "1.5em", textAlign: block.alignment }}
          value={block.text}
        />
      )
    case "bullet_list":
    case "numbered_list": {
      const List = block.type === "bullet_list" ? "ul" : "ol"

      return (
        <List
          className={cn(block.type === "bullet_list" ? "list-disc" : "list-decimal", "grid gap-[0.2em]")}
          style={{ lineHeight: 1.5, paddingLeft: "1.4em" }}
        >
          {block.items.map((item: string, index: number) => (
            <EditableText
              as="li"
              caretKey={`${block.id}:${index}`}
              editable={actions.textEditable}
              key={index}
              label="List item"
              onChange={(text) => actions.onListInput(block, index, text)}
              onFocus={() => actions.controller.setActiveBlockId(block.id)}
              onKeyDown={(event, caret) => actions.onListKeyDown(event, caret, block, index)}
              placeholder="List item"
              value={item}
            />
          ))}
        </List>
      )
    }
    case "table":
      return (
        <table className="w-full border-collapse" style={{ fontSize: "0.9em", lineHeight: 1.4 }}>
          <thead>
            <tr>
              {block.headers.map((header: string, column: number) => (
                <EditableText
                  as="th"
                  caretKey={`${block.id}:h${column}`}
                  className="border border-border bg-muted/50 px-[0.6em] py-[0.4em] text-left font-semibold"
                  editable={actions.textEditable}
                  key={column}
                  label={`Column ${column + 1} heading`}
                  onChange={(text) =>
                    actions.controller.updateBlock(
                      { ...block, headers: block.headers.map((value, i) => (i === column ? text : value)) },
                      `table:${block.id}`
                    )
                  }
                  onKeyDown={preventEnter}
                  value={header}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row: string[], rowIndex: number) => (
              <tr key={rowIndex}>
                {row.map((cell: string, column: number) => (
                  <EditableText
                    as="td"
                    caretKey={`${block.id}:${rowIndex}-${column}`}
                    className="border border-border px-[0.6em] py-[0.4em] align-top"
                    editable={actions.textEditable}
                    key={column}
                    label={`Row ${rowIndex + 1}, column ${column + 1}`}
                    onChange={(text) =>
                      actions.controller.updateBlock(
                        {
                          ...block,
                          rows: block.rows.map((values, r) =>
                            r === rowIndex ? values.map((value, c) => (c === column ? text : value)) : values
                          ),
                        },
                        `table:${block.id}`
                      )
                    }
                    onKeyDown={preventEnter}
                    value={cell}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "image":
    case "divider":
      return (
        <TemplateStaticBlock
          accentColorVariable="var(--doc-accent)"
          block={block}
          primaryColorVariable="var(--doc-primary)"
        />
      )
    default:
      return actions.fields === "design" ? (
        <DesignField block={block} />
      ) : (
        <GeneratedBlock
          answers={actions.answers}
          block={block}
          editable={actions.fields === "fill"}
          fileFieldContent={{}}
          onAnswerChange={actions.onAnswerChange}
          recipientSigned={false}
          recipientSigning={false}
        />
      )
  }
}

/**
 * A field as the author sees it while building: its label and the space the
 * answer will take, the way the PDF draws it.
 *
 * @param props - The field.
 * @returns The field's placeholder.
 */
function DesignField({ block }: { block: FieldBlock }): ReactElement {
  const box = "rounded-[0.35em] border border-border px-[0.7em] text-muted-foreground"
  const label = (
    <span className="font-semibold" style={{ fontSize: "0.9em" }}>
      {block.label}
      {block.required ? <span className="text-destructive"> *</span> : null}
    </span>
  )
  let answer: ReactNode

  switch (block.type) {
    case "checkbox_field":
      return (
        <span className="flex items-center gap-[0.6em]">
          <span aria-hidden="true" className="size-[1.1em] rounded-[0.2em] border border-muted-foreground/50" />
          {label}
        </span>
      )
    case "text_field":
      answer = (
        <span className={cn(box, "flex py-[0.45em]")} style={{ minHeight: block.multiline ? "5em" : undefined }}>
          {block.placeholder || "Text"}
        </span>
      )
      break
    case "date_field":
      answer = (
        <span className={cn(box, "flex items-center justify-between py-[0.45em]")}>
          dd / mm / yyyy
          <CalendarDays aria-hidden="true" className="size-[1.1em]" />
        </span>
      )
      break
    case "dropdown_field":
      answer = (
        <span className={cn(box, "flex items-center justify-between py-[0.45em]")}>
          {block.placeholder || "Choose an option"}
          <ChevronDown aria-hidden="true" className="size-[1.1em]" />
        </span>
      )
      break
    case "initials_field":
      answer = <span className={cn(box, "flex h-[4em] w-[9em] items-end border-dashed pb-[0.4em]")}>Initials</span>
      break
    case "signature_field":
      answer = <span className={cn(box, "flex h-[5.5em] items-end border-dashed pb-[0.4em]")}>Sign here</span>
      break
    case "file_field":
      answer = <span className={cn(box, "flex border-dashed py-[0.9em]")}>Choose a file</span>
      break
  }

  return (
    <span className="grid gap-[0.4em]">
      {label}
      {answer}
      {block.helpText ? (
        <span className="text-muted-foreground" style={{ fontSize: "0.85em" }}>
          {block.helpText}
        </span>
      ) : null}
    </span>
  )
}

function BlockToolbar({ actions, block }: { actions: CanvasActions; block: TemplateBlock }): ReactElement {
  const { controller } = actions
  const blocks = controller.content.blocks
  const index = blocks.findIndex((candidate) => candidate.id === block.id)

  function turnInto(kind: TextBlockKind): void {
    const isList = kind.type === "bullet_list" || kind.type === "numbered_list"

    controller.change((current) => convertTextBlock(current, block.id, kind).content)
    controller.requestFocus({ blockId: block.id, item: isList ? 0 : undefined, offset: 0 })
  }

  return (
    <div
      className="absolute right-0 bottom-full z-30 mb-[0.8em] flex items-center gap-0.5 rounded-[12px] border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
      data-slot="block-toolbar"
      role="toolbar"
      aria-label="Block"
    >
      {isLine(block) || isList(block) ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button className="h-10 gap-1 px-2 font-normal md:h-8" size="sm" type="button" variant="ghost">
                {describeLine(block)}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
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
              <Button aria-label="Align" className="size-10 md:size-8" size="icon-sm" title="Align" type="button" variant="ghost">
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
      {isField(block) ? (
        <ToolButton
          label={block.required ? "Make optional" : "Make required"}
          onClick={() => controller.updateBlock({ ...block, required: !block.required })}
          pressed={block.required}
        >
          <Asterisk />
        </ToolButton>
      ) : null}
      {isField(block) || block.type === "table" || block.type === "image" ? (
        <ToolButton label="Settings" onClick={() => controller.openSettings(block.id)}>
          <Settings2 />
        </ToolButton>
      ) : null}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
      <ToolButton label="Duplicate" onClick={() => controller.duplicate(block.id)}>
        <Copy />
      </ToolButton>
      <ToolButton disabled={index <= 0} label="Move up" onClick={() => controller.move(block.id, "up")}>
        <ArrowUp />
      </ToolButton>
      <ToolButton
        disabled={index >= blocks.length - 1}
        label="Move down"
        onClick={() => controller.move(block.id, "down")}
      >
        <ArrowDown />
      </ToolButton>
      <ToolButton label="Delete" onClick={() => controller.remove(block.id)}>
        <Trash2 />
      </ToolButton>
    </div>
  )
}

function ToolButton({
  children,
  disabled,
  label,
  onClick,
  pressed,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
  pressed?: boolean
}): ReactElement {
  return (
    <Button
      aria-label={label}
      aria-pressed={pressed}
      className={cn("size-10 md:size-8", pressed && "bg-secondary text-secondary-foreground")}
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

function preventEnter(event: KeyboardEvent<HTMLElement>): void {
  if (event.key === "Enter") {
    event.preventDefault()
  }
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
