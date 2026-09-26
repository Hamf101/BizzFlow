"use client"

import { type Editor, Extension, type JSONContent, Node } from "@tiptap/core"
import { Bold } from "@tiptap/extension-bold"
import { Highlight } from "@tiptap/extension-highlight"
import { Italic } from "@tiptap/extension-italic"
import { Link } from "@tiptap/extension-link"
import { Strike } from "@tiptap/extension-strike"
import { TextStyle } from "@tiptap/extension-text-style"
import { Underline } from "@tiptap/extension-underline"
import type { Node as ProseNode } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"
import { EditorContent, useEditor } from "@tiptap/react"
import { type CSSProperties, type ReactElement, useEffect, useRef, useSyncExternalStore } from "react"

import { PLACEHOLDER_CLASS, type TextCaret } from "@/components/editor/editable-text"
import { RichText } from "@/components/templates/rich-text"
import { cn } from "@/lib/utils"
import { fitRuns, textRunSchema, type TextRun } from "@/types/template"

// The document is the line itself: its words and their formatting, nothing more.
const Line = Node.create({ content: "inline*", name: "doc", topNode: true })
const Text = Node.create({ group: "inline", name: "text" })

// A word's colour and size, drawn the way RichText draws them: the colour
// with the class a dark screen adapts it by, and the size in points of the
// printed page, at however many pixels a point takes on the surface.
const Ink = Extension.create({
  addGlobalAttributes: () => [
    {
      attributes: {
        color: {
          default: null,
          parseHTML: (element: HTMLElement) => /(?:^|;)\s*color:\s*(#[0-9a-f]{6})\b/i.exec(element.getAttribute("style") ?? "")?.[1] ?? null,
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.color ? { class: "doc-ink", style: `--doc-ink: ${attributes.color}; color: ${attributes.color}` } : {},
        },
        size: {
          default: null,
          // Only a size copied from a line comes back; pasted text takes the page's.
          parseHTML: (element: HTMLElement) =>
            Number(/--doc-pt[^*]*\*\s*([\d.]+)/.exec(element.getAttribute("style") ?? "")?.[1]) || null,
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.size ? { style: `font-size: calc(var(--doc-pt, 1.4px) * ${attributes.size})` } : {},
        },
      },
      types: ["textStyle"],
    },
  ],
  name: "ink",
})

// Highlights carry their colour for a dark screen to tint with, as RichText's do.
const Highlighter = Highlight.extend({
  addAttributes: () => ({
    color: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-color"),
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.color
          ? {
              class: "doc-highlight",
              "data-color": attributes.color,
              style: `--doc-highlight: ${attributes.color}; background-color: ${attributes.color}; color: inherit`,
            }
          : {},
    },
  }),
})

/** What a line can hold: the marks the toolbar puts on words. */
export const LINE_EXTENSIONS = [
  Line,
  Text,
  Bold,
  Italic,
  Underline,
  Strike,
  TextStyle,
  Ink,
  Highlighter.configure({ multicolor: true }),
  Link.configure({
    defaultProtocol: "https",
    HTMLAttributes: { class: "underline underline-offset-2", rel: "noopener noreferrer", target: "_blank" },
    // The same addresses a saved document keeps: web pages and email.
    isAllowedUri: (url: string) => textRunSchema.shape.link.safeParse(url).success,
    openOnClick: false,
  }),
]

type RichLineProps = {
  as: "div" | "h1" | "h2" | "h3" | "li"
  caretKey: string
  className?: string
  /** Where to put the caret, once for each request. */
  focus?: Readonly<{ nonce: number; offset: number }> | null
  label: string
  onChange: (text: string, runs: TextRun[] | undefined, caret: number) => void
  onFocus?: (editor: Editor) => void
  /** Says the line's editor is going, so nothing keeps acting on it. */
  onGone?: (editor: Editor) => void
  onKeyDown?: (event: KeyboardEvent, caret: TextCaret) => void
  placeholder?: string
  runs?: readonly TextRun[]
  style?: CSSProperties
  value: string
}

/**
 * One line typed straight onto the page, words formatted as the toolbar sets
 * them. The canvas still owns what Enter, Backspace and the arrows do between
 * lines: every key goes to it first, and a key it takes stops here.
 *
 * @param props - The line's text and formatting, and its handlers.
 * @returns The editable line.
 */
export function RichLine({
  as: Element,
  caretKey,
  className,
  focus,
  label,
  onChange,
  onFocus,
  onGone,
  onKeyDown,
  placeholder,
  runs,
  style,
  value,
}: RichLineProps): ReactElement {
  const handlers = useRef({ onGone, onKeyDown })
  // Lines the server drew wait for hydration; a line added later, as by Enter,
  // is ready to type in the moment it appears.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)
  const editor = useEditor({
    content: lineContent(value, runs),
    editorProps: {
      attributes: {
        "aria-label": label,
        "aria-multiline": "false",
        class: "min-w-0 break-words whitespace-pre-wrap outline-none",
        "data-caret-key": caretKey,
        role: "textbox",
        spellcheck: "true",
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing) {
          return false
        }

        handlers.current.onKeyDown?.(event, readCaret(view.state))
        return event.defaultPrevented
      },
      // Pasted words land on this one line.
      transformPastedText: (text: string) => text.replace(/\s+/g, " "),
    },
    enableInputRules: false,
    enablePasteRules: false,
    extensions: LINE_EXTENSIONS,
    immediatelyRender: hydrated,
    injectCSS: false,
    onFocus: ({ editor: line }) => onFocus?.(line),
    onUpdate: ({ editor: line }) => {
      const read = readLine(line.state.doc)
      onChange(read.text, read.runs, line.state.selection.head)
    },
    shouldRerenderOnTransaction: false,
  })

  useEffect(() => {
    handlers.current = { onGone, onKeyDown }
  })

  // A change from elsewhere, such as an undo, rewrites the line.
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    const shown = readLine(editor.state.doc)

    if (shown.text !== value || JSON.stringify(shown.runs) !== JSON.stringify(fitRuns(value, runs))) {
      editor.commands.setContent(lineContent(value, runs), { emitUpdate: false })
    }
  }, [editor, runs, value])

  // At once rather than on the next frame as Tiptap's focus does, so keys
  // pressed straight after Enter land in the new line.
  useEffect(() => {
    if (editor && focus) {
      editor.commands.setTextSelection(Math.min(focus.offset, editor.state.doc.content.size))
      editor.view.focus()
      editor.commands.scrollIntoView()
    }
  }, [editor, focus])

  useEffect(() => () => void (editor && handlers.current.onGone?.(editor)), [editor])

  return (
    <Element
      className={cn("min-w-0 break-words whitespace-pre-wrap", placeholder && PLACEHOLDER_CLASS, className)}
      data-empty={value.length === 0}
      data-line-key={caretKey}
      data-placeholder={placeholder}
      style={style}
    >
      {/* The words as they will print, until the line can be typed in. */}
      {editor ? <EditorContent className="contents" editor={editor} /> : <RichText runs={runs} text={value} />}
    </Element>
  )
}

/**
 * Reads a line's words and formatting as a saved document keeps them.
 *
 * @param doc - The line.
 * @returns Its text, and its formatting when it has any.
 */
export function readLine(doc: ProseNode): { runs?: TextRun[]; text: string } {
  const runs: TextRun[] = []

  doc.forEach((node: ProseNode) => {
    const run: TextRun = { text: node.text ?? "" }

    for (const { attrs, type } of node.marks) {
      if (type.name === "bold" || type.name === "italic" || type.name === "underline" || type.name === "strike") {
        run[type.name] = true
      } else if (type.name === "link") {
        keep(run, "link", attrs.href)
      } else if (type.name === "highlight") {
        keep(run, "highlight", attrs.color)
      } else if (type.name === "textStyle") {
        keep(run, "color", attrs.color)
        keep(run, "size", attrs.size)
      }
    }

    runs.push(run)
  })

  const text = doc.textContent

  return { runs: fitRuns(text, runs), text }
}

/**
 * Writes a line's words and formatting as the editor holds them.
 *
 * @param text - The words.
 * @param runs - Their formatting, if they have any.
 * @returns The line's content.
 */
export function lineContent(text: string, runs?: readonly TextRun[]): JSONContent {
  const parts = fitRuns(text, runs) ?? (text ? [{ text }] : [])

  return {
    content: parts.map((run: TextRun) => ({
      marks: [
        ...(["bold", "italic", "underline", "strike"] as const).filter((mark) => run[mark]).map((type) => ({ type })),
        ...(run.link ? [{ attrs: { href: run.link }, type: "link" }] : []),
        ...(run.highlight ? [{ attrs: { color: run.highlight }, type: "highlight" }] : []),
        ...(run.color || run.size ? [{ attrs: { color: run.color ?? null, size: run.size ?? null }, type: "textStyle" }] : []),
      ],
      text: run.text,
      type: "text",
    })),
    type: "doc",
  }
}

function subscribeNever(): () => void {
  return () => undefined
}

function readCaret(state: EditorState): TextCaret {
  const { empty, head } = state.selection
  const line = readLine(state.doc)

  return {
    atEnd: head === state.doc.content.size,
    atStart: head === 0,
    collapsed: empty,
    offset: head,
    runs: line.runs,
    text: line.text,
  }
}

// Keeps a mark's value only when a saved document would: a colour as #rrggbb,
// a size in range, a link to a web page or an email address.
function keep<Key extends "color" | "highlight" | "link" | "size">(run: TextRun, key: Key, value: unknown): void {
  if (value !== null && value !== undefined && textRunSchema.shape[key].safeParse(value).success) {
    run[key] = value as TextRun[Key]
  }
}
