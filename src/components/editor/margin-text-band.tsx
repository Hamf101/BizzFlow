"use client"

import { type CSSProperties, type ReactElement, useCallback } from "react"

import { cn } from "@/lib/utils"

import { shouldRenderTemplateFooter, shouldRenderTemplateHeader } from "@/services/templates/template-render-plan"
import type { TemplateLayout } from "@/types/template"

const SLOTS = [
  ["left", "Left"],
  ["center", "Centre"],
  ["right", "Right"],
] as const

/**
 * The header's or footer's words, typed straight onto the page's margin as a
 * word processor has it after a double-click there: one line, with Tab moving
 * on to the centre and then the right, as Word's header tab stops do. A dashed
 * line and a label mark it off from the page's text. Escape or Enter, or
 * leaving it, puts the page back.
 *
 * @param props - Which margin, the layout and how to change it, the page it is written on, where it sits, and how to close it.
 * @returns The three slots, left, centre and right.
 */
export function MarginTextBand({
  edge,
  layout,
  onChange,
  onClose,
  page,
  pageLabel,
  style,
}: {
  edge: "header" | "footer"
  layout: TemplateLayout
  onChange: (layout: TemplateLayout, coalesceKey?: string) => void
  onClose: () => void
  /** One-based page it is written on, so the words show there. */
  page: number
  /** What prints at the right when nothing is written there, such as "Page 1 of 2". */
  pageLabel?: string | null
  style: CSSProperties
}): ReactElement {
  const key = edge === "header" ? "headerText" : "footerText"
  const label = edge === "header" ? "Header" : "Footer"
  // Once, as it opens and before its first slot takes the caret (a scroll
  // after that loses it): clear of the zoom control at the window's foot.
  const band = useCallback((element: HTMLDivElement | null) => element?.scrollIntoView?.({ block: "nearest" }), [])

  return (
    <div
      className="absolute inset-x-0 z-30 flex scroll-my-24 flex-col justify-center gap-[0.3em] border-dashed border-primary/50 bg-card"
      data-slot="margin-text-band"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      ref={band}
      style={{ ...style, [edge === "header" ? "borderBottomWidth" : "borderTopWidth"]: 1 }}
    >
      <div className="grid grid-cols-3">
        {SLOTS.map(([slot, slotLabel], index) => (
          <input
            aria-label={`${label} ${slotLabel.toLowerCase()}`}
            autoFocus={index === 0}
            className="h-[1.8em] min-w-0 rounded-[0.2em] bg-transparent text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-primary/5"
            key={slot}
            maxLength={120}
            onChange={(event) => onChange(setMarginText(layout, key, slot, event.target.value, page), `${key}:${slot}`)}
            // What prints there when nothing is typed, such as the page number, shows faintly.
            placeholder={index === 0 ? `Type the ${edge}` : slot === "right" && pageLabel ? pageLabel : undefined}
            style={{ textAlign: slot }}
            value={layout[key]?.[slot] ?? ""}
          />
        ))}
      </div>
      <span className={cn("text-[0.85em] text-muted-foreground", edge === "footer" && "-order-1")}>{label} · Tab to the centre and right</span>
    </div>
  )
}

/**
 * The layout with one slot of the header or footer rewritten. An emptied slot
 * is removed, and a margin with none left drops its text. Words written where
 * that margin would not show turn it on for every page, so they show.
 *
 * @param layout - The layout.
 * @param key - The header's or footer's words.
 * @param slot - Left, centre or right.
 * @param value - What is written there now.
 * @param page - One-based page it is written on.
 * @returns The new layout.
 */
export function setMarginText(
  layout: TemplateLayout,
  key: "headerText" | "footerText",
  slot: "left" | "center" | "right",
  value: string,
  page = 1
): TemplateLayout {
  const text = Object.fromEntries(Object.entries({ ...layout[key], [slot]: value }).filter(([, words]) => words?.trim()))
  const header = key === "headerText"
  const policy = header ? "headerPolicy" : "footerPolicy"
  const written = Object.keys(text).length > 0
  const shows = (header ? shouldRenderTemplateHeader : shouldRenderTemplateFooter)(layout, page)

  return {
    ...layout,
    [key]: written ? text : undefined,
    [policy]: written && !shows ? "all_pages" : layout[policy],
  }
}
