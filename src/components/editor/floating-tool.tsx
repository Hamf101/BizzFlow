"use client"

import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react"

import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenuContent } from "@/components/ui/dropdown-menu"

/** A tool's place, as shares of the free canvas across and down, 0 to 1. */
export type Spot = Readonly<{ x: number; y: number }>

// A press that travels this far is a drag rather than a click.
const DRAG_THRESHOLD = 4
// Tools keep this far from the canvas's edges, as in `place`.
const EDGE = 16

type Press = {
  from: Spot
  pointerId: number
  /** How far the tool can travel, across and down, in pixels. */
  room: { height: number; width: number }
  started: boolean
  x: number
  y: number
}

/**
 * Keeps one of the editor's floating tools where its owner put it. The whole
 * tool drags, with no handle of its own, and a right-click opens its menu.
 * The spot is kept as shares of the free canvas, so at any size the tool stays
 * in place and on screen.
 *
 * @param props - The tool, its menu, where it is, and where it was dropped.
 * @returns The placed tool.
 */
export function FloatingTool({
  children,
  menu,
  onMove,
  spot,
}: {
  children: ReactNode
  menu: ReactNode
  onMove: (spot: Spot) => void
  spot: Spot
}): ReactElement {
  const [moving, setMoving] = useState<Spot | null>(null)
  const swallowClick = useRef(false)

  function startPress(event: PointerEvent<HTMLDivElement>): void {
    const area = event.currentTarget.parentElement?.getBoundingClientRect()
    const box = event.currentTarget.getBoundingClientRect()

    // Only a plain primary press drags; Ctrl-click is a right click on a Mac.
    if (!area || event.button !== 0 || event.ctrlKey) {
      return
    }

    const press: Press = {
      from: spot,
      pointerId: event.pointerId,
      room: {
        height: Math.max(1, area.height - 2 * EDGE - box.height),
        width: Math.max(1, area.width - 2 * EDGE - box.width),
      },
      started: false,
      x: event.clientX,
      y: event.clientY,
    }
    const follow = (at: { clientX: number; clientY: number }): Spot => ({
      x: clamp(press.from.x + (at.clientX - press.x) / press.room.width),
      y: clamp(press.from.y + (at.clientY - press.y) / press.room.height),
    })

    // The window hears every move, even one that leaves the tool at once.
    function move(moveEvent: globalThis.PointerEvent): void {
      if (moveEvent.pointerId !== press.pointerId) {
        return
      }

      if (!press.started && Math.hypot(moveEvent.clientX - press.x, moveEvent.clientY - press.y) < DRAG_THRESHOLD) {
        return
      }

      press.started = true
      moveEvent.preventDefault()
      setMoving(follow(moveEvent))
    }

    function end(endEvent: globalThis.PointerEvent): void {
      if (endEvent.pointerId !== press.pointerId) {
        return
      }

      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      setMoving(null)

      if (press.started && endEvent.type === "pointerup") {
        // A drag dropped back on a tool must not also press it.
        swallowClick.current = true
        window.setTimeout(() => {
          swallowClick.current = false
        }, 0)
        onMove(follow(endEvent))
      }
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="pointer-events-auto absolute touch-none select-none"
        onClickCapture={(event: MouseEvent<HTMLDivElement>): void => {
          if (swallowClick.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onPointerDown={startPress}
        style={place(moving ?? spot)}
      >
        {children}
      </ContextMenuTrigger>
      <DropdownMenuContent className="w-40">{menu}</DropdownMenuContent>
    </ContextMenu>
  )
}

// Inside the canvas's edges at every share: the tool's own size comes off
// through `translate`, whose percentages are of the tool itself.
function place(spot: Spot): CSSProperties {
  return {
    left: `calc(${EDGE}px + ${spot.x} * (100% - ${2 * EDGE}px))`,
    top: `calc(${EDGE}px + ${spot.y} * (100% - ${2 * EDGE}px))`,
    translate: `${-spot.x * 100}% ${-spot.y * 100}%`,
  }
}

function clamp(share: number): number {
  return Math.min(1, Math.max(0, share))
}
