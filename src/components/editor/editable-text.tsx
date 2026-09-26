"use client"

import {
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useLayoutEffect,
  useRef,
} from "react"

import { cn } from "@/lib/utils"
import type { TextRun } from "@/types/template"

/** The caret inside one editable line when a key goes down. */
export type TextCaret = Readonly<{
  atEnd: boolean
  atStart: boolean
  collapsed: boolean
  offset: number
  /** The line's formatting, when it has any. */
  runs?: TextRun[]
  text: string
}>

/**
 * Lays a line's placeholder over it rather than writing it in, so the caret
 * waits where typing starts and an emptied line keeps one line's height.
 */
export const PLACEHOLDER_CLASS =
  "relative min-h-[1lh] data-[empty=true]:before:pointer-events-none data-[empty=true]:before:absolute data-[empty=true]:before:inset-x-0 data-[empty=true]:before:text-muted-foreground/55 data-[empty=true]:before:content-[attr(data-placeholder)]"

type EditableTextProps = {
  as?: "div" | "h1" | "h2" | "h3" | "li" | "p" | "td" | "th"
  /** `block` or `block:item`, so the canvas can put the caret back after an edit. */
  caretKey: string
  className?: string
  editable: boolean
  label?: string
  /** The new text, and how many characters sit before the caret. */
  onChange: (text: string, caretOffset: number) => void
  onFocus?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLElement>, caret: TextCaret) => void
  placeholder?: string
  style?: CSSProperties
  value: string
}

/**
 * One line of text typed straight onto the page. The DOM is written only when
 * the value changes from outside, such as an undo, so typing never loses the
 * caret. Pasted text arrives as plain words on one line.
 *
 * @param props - The text, whether it can be edited, and its handlers.
 * @returns The editable line.
 */
export function EditableText({
  as: Element = "div",
  caretKey,
  className,
  editable,
  label,
  onChange,
  onFocus,
  onKeyDown,
  placeholder,
  style,
  value,
}: EditableTextProps): ReactElement {
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const element = ref.current

    if (element && element.textContent !== value) {
      element.textContent = value
    }
  }, [value])

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const element = ref.current

    if (!element || !onKeyDown) {
      return
    }

    const text = element.textContent ?? ""
    const selection = window.getSelection()
    const offset = readCaretOffset(element)

    onKeyDown(event, {
      atEnd: offset === text.length,
      atStart: offset === 0,
      collapsed: selection?.isCollapsed ?? true,
      offset,
      text,
    })
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>): void {
    event.preventDefault()
    const words = event.clipboardData.getData("text/plain").replace(/\s+/g, " ")

    // ponytail: execCommand keeps the browser's own undo and input events for a
    // paste; replace it with the Selection API when browsers drop it.
    document.execCommand("insertText", false, words)
  }

  return (
    <Element
      aria-label={label}
      aria-multiline={editable ? false : undefined}
      className={cn(
        "min-w-0 break-words whitespace-pre-wrap outline-none",
        editable && "cursor-text",
        placeholder && PLACEHOLDER_CLASS,
        className
      )}
      contentEditable={editable ? "plaintext-only" : undefined}
      data-caret-key={caretKey}
      data-empty={value.length === 0}
      data-placeholder={placeholder}
      onFocus={onFocus}
      onInput={(event) =>
        onChange(event.currentTarget.textContent ?? "", readCaretOffset(event.currentTarget))
      }
      onKeyDown={handleKeyDown}
      onPaste={editable ? handlePaste : undefined}
      ref={ref as never}
      role={editable ? "textbox" : undefined}
      spellCheck={editable}
      style={style}
      suppressContentEditableWarning
      tabIndex={editable ? 0 : undefined}
    />
  )
}

/**
 * Reads how many characters sit before the caret in an element.
 *
 * @param element - The editable element.
 * @returns The caret's offset, or the text's length when the caret is elsewhere.
 */
export function readCaretOffset(element: HTMLElement): number {
  const selection = window.getSelection()

  if (!selection || selection.rangeCount === 0 || !element.contains(selection.focusNode)) {
    return element.textContent?.length ?? 0
  }

  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(selection.focusNode as Node, selection.focusOffset)

  return range.toString().length
}
