"use client"

import { type ReactElement, useRef } from "react"

import { cn } from "@/lib/utils"
import { maxMargin, type PageSide, resolvePageGeometry } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

const SIDES: readonly PageSide[] = ["top", "right", "bottom", "left"]

/**
 * The page's margins as dashed lines to drag, in the points the PDF prints
 * them at. Focused, the arrow keys move one a point at a time, or ten with
 * Shift. Every page shows them; only the first page's are in the tab order,
 * so the keyboard meets them once.
 *
 * @param props - The layout, how to change it, the page's scale, and whether this is the first page.
 * @returns The four guides.
 */
export function MarginGuides({
  first,
  layout,
  onChange,
  point,
  zoom,
}: {
  first: boolean
  layout: TemplateLayout
  onChange: (layout: TemplateLayout, coalesceKey?: string) => void
  /** Pixels a point takes on the page, before zoom. */
  point: number
  zoom: number
}): ReactElement {
  const geometry = resolvePageGeometry(layout)
  const drag = useRef<{ from: number; value: number } | null>(null)

  function set(side: PageSide, value: number): void {
    const margin = Math.round(Math.max(0, Math.min(maxMargin(geometry, side), value)))

    onChange({ ...layout, margins: { ...geometry.margins, [side]: margin } }, `margin:${side}`)
  }

  return (
    <>
      {SIDES.map((side) => {
        const across = side === "left" || side === "right"
        // Dragging toward the middle of the page widens every margin.
        const inward = side === "left" || side === "top" ? 1 : -1
        const value = Math.round(geometry.margins[side])

        return (
          <div
            aria-hidden={first ? undefined : true}
            aria-label={`${side[0]!.toUpperCase()}${side.slice(1)} margin`}
            aria-orientation={across ? "horizontal" : "vertical"}
            aria-valuemax={maxMargin(geometry, side)}
            aria-valuemin={0}
            aria-valuenow={value}
            aria-valuetext={`${value} points`}
            className={cn(
              "absolute z-20 touch-none border-dashed border-primary/25 outline-none hover:border-primary/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/40",
              across ? "inset-y-0 w-2.5 cursor-ew-resize" : "inset-x-0 h-2.5 cursor-ns-resize",
              { bottom: "translate-y-full border-t", left: "-translate-x-full border-r", right: "translate-x-full border-l", top: "-translate-y-full border-b" }[side]
            )}
            key={side}
            onKeyDown={(event) => {
              const step = { ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1 }[event.key]

              if (step) {
                event.preventDefault()
                set(side, value + inward * step * (event.shiftKey ? 10 : 1))
              }
            }}
            onPointerCancel={() => (drag.current = null)}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { from: across ? event.clientX : event.clientY, value }
            }}
            onPointerMove={(event) => {
              if (drag.current) {
                set(side, drag.current.value + (inward * ((across ? event.clientX : event.clientY) - drag.current.from)) / (point * zoom))
              }
            }}
            onPointerUp={() => (drag.current = null)}
            role="slider"
            style={{ [side]: value * point }}
            tabIndex={first ? 0 : -1}
            title={`${value} pt`}
          />
        )
      })}
    </>
  )
}
