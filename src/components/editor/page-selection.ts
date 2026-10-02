"use client"

import type { Editor } from "@tiptap/core"
import { type RefObject, useEffect, useRef } from "react"

import type { CaretTarget } from "@/components/editor/editor-content"

type Point = Readonly<{ node: Node; offset: number }>

/**
 * Lets a selection run across the page's blocks, as on a sheet of paper.
 * Each line is typed in on its own, and a browser keeps a selection inside
 * the line it began in; so once a drag leaves its line, every line stops
 * taking typing for as long as the selection lasts, and the selection follows
 * the pointer across the page. Copying it copies what was selected; deleting,
 * cutting or typing over it takes out the words and blocks between its ends.
 * A click, Escape or an arrow lets it go, and the lines take typing again.
 *
 * @param options - The page, whether its words can be typed in, and what a
 *   replaced selection and a caret put back at one of its ends do.
 */
export function usePageSelection(options: {
  enabled: boolean
  onCaret: (point: CaretTarget) => void
  onReplace: (from: CaretTarget, to: CaretTarget, text: string) => void
  root: RefObject<HTMLElement | null>
}): void {
  const latest = useRef(options)

  useEffect(() => {
    latest.current = options
  })

  const { enabled, root } = options

  useEffect(() => {
    const page = root.current

    if (!enabled || !page) {
      return undefined
    }

    const state: { anchor: Point | null; dragging: boolean; unlock: (() => void) | null } = { anchor: null, dragging: false, unlock: null }

    function release(): void {
      state.unlock?.()
      state.unlock = null
      state.dragging = false
    }

    function down(event: PointerEvent): void {
      // Any press lets a selection across the page go, before the press places a caret.
      release()
      state.anchor = null

      const target = event.target as Element | null

      if (event.button === 0 && event.pointerType !== "touch" && target?.closest("[data-line-key]") && page?.contains(target)) {
        state.anchor = pointAt(event.clientX, event.clientY)
      }
    }

    function move(event: PointerEvent): void {
      const { anchor } = state

      if (!anchor || !(event.buttons & 1)) {
        return
      }

      if (!state.unlock) {
        const under = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-block-id]")
        const from = element(anchor.node)?.closest("[data-block-id]")

        // Still inside the block it began in, the line keeps its own selection;
        // words held long enough to move their block are not selected either.
        if (!under || under === from || !page?.contains(under) || page.querySelector("[data-held]")) {
          return
        }

        state.unlock = lock(page)
        state.dragging = true
      }

      const focus = pointAt(event.clientX, event.clientY)

      if (focus && state.dragging) {
        const select = (): void => void window.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)

        select()
        // The browser's own drag moves the selection too; this one has the last word.
        requestAnimationFrame(select)
      }
    }

    function up(): void {
      state.dragging = false

      if (state.unlock && window.getSelection()?.isCollapsed) {
        release()
      }
    }

    function key(event: KeyboardEvent): void {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null

      if (!state.unlock || !range || !page) {
        return
      }

      const mod = event.metaKey || event.ctrlKey
      const lower = event.key.toLowerCase()
      const ends = (): [CaretTarget, CaretTarget] | null => {
        const from = caretAt(page, range.startContainer, range.startOffset, "start")
        const to = caretAt(page, range.endContainer, range.endOffset, "end")

        return from && to ? [from, to] : null
      }
      const replace = (text: string): void => {
        const both = ends()

        event.preventDefault()
        release()
        selection?.removeAllRanges()

        if (both) latest.current.onReplace(both[0], both[1], text)
      }

      if (mod && lower === "c") {
        // The browser copies what is selected.
        return
      }

      if (mod && lower === "a") {
        const blocks = page.querySelectorAll("[data-block-id]")
        const last = blocks[blocks.length - 1]

        event.preventDefault()
        if (blocks[0] && last) selection?.setBaseAndExtent(blocks[0], 0, last, last.childNodes.length)
      } else if (mod && lower === "x") {
        document.execCommand("copy")
        replace("")
      } else if (event.key === "Backspace" || event.key === "Delete") {
        replace("")
      } else if (event.key.length === 1 && !mod && !event.altKey) {
        replace(event.key)
      } else if (event.key === "Escape" || event.key.startsWith("Arrow")) {
        const both = ends()

        event.preventDefault()
        release()
        selection?.removeAllRanges()

        // The caret goes to the end the arrow points at.
        if (both) latest.current.onCaret(event.key === "ArrowRight" || event.key === "ArrowDown" ? both[1] : both[0])
      }
    }

    // The line the selection began in would copy only its own words.
    function copy(event: ClipboardEvent): void {
      const selection = window.getSelection()

      if (!state.unlock || !selection?.rangeCount || !event.clipboardData) {
        return
      }

      const holder = document.createElement("div")

      holder.append(selection.getRangeAt(0).cloneContents())
      event.clipboardData.setData("text/plain", selection.toString())
      event.clipboardData.setData("text/html", holder.innerHTML)
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener("copy", copy, true)
    document.addEventListener("pointerdown", down, true)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("keydown", key, true)

    return () => {
      release()
      document.removeEventListener("copy", copy, true)
      document.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("keydown", key, true)
    }
  }, [enabled, root])
}

// Every line stops taking typing, so a selection can cross between them;
// what is returned lets them take it again.
function lock(page: HTMLElement): () => void {
  const lines = [...page.querySelectorAll<HTMLElement & { editor?: Editor }>("[contenteditable]")]
  const saved = lines.map((line) => line.getAttribute("contenteditable"))

  for (const line of lines) {
    if (line.editor) {
      line.editor.setEditable(false, false)
    } else {
      line.setAttribute("contenteditable", "false")
    }
  }

  return () =>
    lines.forEach((line, index) => {
      if (line.editor) {
        if (!line.editor.isDestroyed) line.editor.setEditable(true, false)
      } else if (saved[index] !== null) {
        line.setAttribute("contenteditable", saved[index]!)
      }
    })
}

function pointAt(x: number, y: number): Point | null {
  const position = document.caretPositionFromPoint?.(x, y)

  if (position) {
    return { node: position.offsetNode, offset: position.offset }
  }

  const range = document.caretRangeFromPoint?.(x, y)

  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

function element(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

/**
 * Where a point in the page's markup is in its content: a line and the place
 * in its words, or, for a point in a block that is not words, that block. A
 * point between blocks belongs to the next block at a selection's start and
 * the one before at its end.
 *
 * @param page - The page.
 * @param node - The point's node.
 * @param offset - The point's offset in it.
 * @param edge - Which end of a selection it is.
 * @returns The point in the content, or null when it is off the page.
 */
export function caretAt(page: HTMLElement, node: Node, offset: number, edge: "start" | "end"): CaretTarget | null {
  const line = element(node)?.closest<HTMLElement>("[data-line-key]")

  if (line && page.contains(line)) {
    const before = document.createRange()

    before.selectNodeContents(line)
    before.setEnd(node, offset)

    return fromKey(line.dataset.lineKey!, before.toString().length)
  }

  let block = element(node)?.closest<HTMLElement>("[data-block-id]") ?? null

  if (!block || !page.contains(block)) {
    const blocks = [...page.querySelectorAll<HTMLElement>("[data-block-id]")]
    const point = document.createRange()

    point.setStart(node, offset)
    block =
      (edge === "start"
        ? blocks.find((candidate) => point.comparePoint(candidate, 0) >= 0)
        : blocks.findLast((candidate) => point.comparePoint(candidate, candidate.childNodes.length) <= 0)) ?? null
  }

  if (!block) {
    return null
  }

  // A block of words met from outside its lines is taken from its first word or to its last.
  const lines = [...block.querySelectorAll<HTMLElement>("[data-line-key]")]
  const whole = edge === "start" ? lines[0] : lines.at(-1)

  return whole ? fromKey(whole.dataset.lineKey!, edge === "start" ? 0 : (whole.textContent ?? "").length) : { blockId: block.dataset.blockId!, offset: 0 }
}

function fromKey(key: string, offset: number): CaretTarget {
  const [blockId, item] = key.split(":")

  return item === undefined ? { blockId: blockId!, offset } : { blockId: blockId!, item: Number(item), offset }
}
