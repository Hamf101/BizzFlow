"use client"

import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react"

/** Where a dragged block would land, and where its line is drawn on screen. */
export type DropTarget<Slot> = Readonly<{
  line: Readonly<{ left: number; top: number; width: number }>
  slot: Slot
  /** Whether it may land there; a drop where it may not says why. */
  valid: boolean
}>

// A press that travels this far is a drag; one on the grip, a little less.
const DRAG_THRESHOLD = 4
const GRIP_THRESHOLD = 2
// How long a press on words rests before it takes the whole block, so a
// quick pull still selects words.
const HOLD_MS = 350
// How near the scrolling area's top or bottom the pointer scrolls it, and
// how many pixels a second at the very edge, whatever the screen's frame rate.
const EDGE = 56
const SPEED = 900

/**
 * Drags blocks to new places with a mouse, pen or finger: the one place in
 * the editor that knows about pointers. A block that is not words drags as
 * soon as it is pulled; words are held still for a moment first, and a
 * finger drags from the grip beside the block in use, so the page still
 * scrolls under it. The block follows the pointer, a line shows where it will
 * land, the page scrolls near its top and bottom, and Escape puts it back.
 *
 * @param options - Where a block lands for a point on screen, what a drop
 *   does, and the canvas's zoom.
 * @returns The block being dragged, the line to draw, and the press handler.
 */
export function useBlockDrag<Slot>(options: {
  locate: (blockId: string, y: number) => DropTarget<Slot> | null
  onDrop: (blockId: string, slot: Slot) => void
  zoom: number
}): {
  begin: (event: PointerEvent<HTMLElement>, blockId: string, grip?: boolean) => void
  dragging: string | null
  indicator: RefObject<HTMLDivElement | null>
} {
  const [dragging, setDragging] = useState<string | null>(null)
  const indicator = useRef<HTMLDivElement>(null)
  const latest = useRef(options)
  const stop = useRef<(() => void) | null>(null)

  useEffect(() => {
    latest.current = options
  })

  // A drag still going when the canvas goes lets go of the page.
  useEffect(() => () => stop.current?.(), [])

  function begin(event: PointerEvent<HTMLElement>, blockId: string, grip = false): void {
    const target = event.target as HTMLElement
    const element = event.currentTarget.closest<HTMLElement>("[data-block-id]")

    // Only a plain primary press drags; Ctrl-click is a right click on a Mac.
    // A finger on a block is scrolling, and a control keeps its own press.
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      !element ||
      (!grip && (event.pointerType === "touch" || target.closest("a, button, input, label, select, textarea, [data-slot=block-toolbar]")))
    ) {
      return
    }

    stop.current?.()

    const block: HTMLElement = element
    const text = !grip && target.closest("[contenteditable]") !== null
    const scroller = block.closest<HTMLElement>("[data-slot=editor-scroll]")
    const root = document.documentElement.style
    const saved = { cursor: root.cursor, userSelect: root.userSelect }
    const press = { held: false, scrollTop: 0, started: false, x: event.clientX, y: event.clientY }
    const from = { x: event.clientX, y: event.clientY }
    let frame = 0
    let tick = 0
    const timer = text
      ? window.setTimeout(() => {
          press.held = true
          block.dataset.held = ""
        }, HOLD_MS)
      : 0

    function pickUp(): void {
      press.started = true
      press.scrollTop = scroller?.scrollTop ?? 0
      // The words held give up their caret and selection: the block is moving.
      if (text) {
        ;(document.activeElement as HTMLElement | null)?.blur()
        window.getSelection()?.removeAllRanges()
      }

      root.cursor = "grabbing"
      root.userSelect = "none"
      setDragging(blockId)
      frame = requestAnimationFrame((now) => {
        tick = now
        scroll(now)
      })
    }

    function follow(): void {
      const { locate, zoom } = latest.current
      const scrolled = (scroller?.scrollTop ?? 0) - press.scrollTop
      const landing = locate(blockId, press.y)
      const line = indicator.current

      block.style.transform = `translate(${(press.x - from.x) / zoom}px, ${(press.y - from.y + scrolled) / zoom}px)`

      if (line) {
        line.hidden = !landing

        if (landing) {
          line.dataset.valid = String(landing.valid)
          line.style.left = `${landing.line.left}px`
          line.style.top = `${landing.line.top}px`
          line.style.width = `${landing.line.width}px`
        }
      }
    }

    // Near the scrolling area's top or bottom, the page scrolls on its own.
    function scroll(now: number): void {
      const seconds = Math.min(0.05, (now - tick) / 1000)
      const box = scroller?.getBoundingClientRect()
      const speed = !box
        ? 0
        : press.y < box.top + EDGE
          ? -SPEED * Math.min(1, (box.top + EDGE - press.y) / EDGE)
          : press.y > box.bottom - EDGE
            ? SPEED * Math.min(1, (press.y - box.bottom + EDGE) / EDGE)
            : 0

      tick = now

      if (scroller && speed) {
        scroller.scrollTop += speed * seconds
        follow()
      }

      frame = requestAnimationFrame(scroll)
    }

    function move(moveEvent: globalThis.PointerEvent): void {
      if (moveEvent.pointerId !== event.pointerId) {
        return
      }

      press.x = moveEvent.clientX
      press.y = moveEvent.clientY

      if (!press.started) {
        const travelled = Math.hypot(press.x - from.x, press.y - from.y)

        // Words pulled before they were held are being selected.
        if (text && !press.held) {
          if (travelled > DRAG_THRESHOLD) {
            end(false)
          }

          return
        }

        if (travelled < (grip ? GRIP_THRESHOLD : text ? 1 : DRAG_THRESHOLD)) {
          return
        }

        pickUp()
      }

      moveEvent.preventDefault()

      if (text) {
        window.getSelection()?.removeAllRanges()
      }

      follow()
    }

    function end(commit: boolean): void {
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("keydown", escape, true)
      delete block.dataset.held
      stop.current = null

      if (!press.started) {
        return
      }

      const landing = commit ? latest.current.locate(blockId, press.y) : null

      block.style.transform = ""
      root.cursor = saved.cursor
      root.userSelect = saved.userSelect
      setDragging(null)
      // A drag ends with a click where it was let go; that click must not act.
      window.addEventListener("click", swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0)

      if (landing) {
        latest.current.onDrop(blockId, landing.slot)
      }
    }

    function up(upEvent: globalThis.PointerEvent): void {
      if (upEvent.pointerId === event.pointerId) {
        end(true)
      }
    }

    function cancel(cancelEvent: globalThis.PointerEvent): void {
      if (cancelEvent.pointerId === event.pointerId) {
        end(false)
      }
    }

    function escape(keyEvent: KeyboardEvent): void {
      if (keyEvent.key === "Escape" && press.started) {
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        end(false)
      }
    }

    stop.current = () => end(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("keydown", escape, true)
  }

  return { begin, dragging, indicator }
}

function swallow(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
}
