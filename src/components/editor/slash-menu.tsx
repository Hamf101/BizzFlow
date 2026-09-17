"use client"

import { type ReactElement, useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import type { InsertChoice } from "@/components/editor/block-catalog"
import { cn } from "@/lib/utils"

/**
 * The menu typing / opens under the caret: everything that can be added,
 * narrowed as the person keeps typing. Arrow keys move, Enter adds, Escape
 * closes; the keys are handled by the line being typed in.
 *
 * @param props - Where the caret is, the matching choices, the active one, and
 *   what choosing does.
 * @returns The floating menu, or a quiet note when nothing matches.
 */
export function SlashMenu({
  activeIndex,
  anchor,
  choices,
  onChoose,
  onHover,
}: {
  activeIndex: number
  anchor: DOMRect
  choices: readonly InsertChoice[]
  onChoose: (choice: InsertChoice) => void
  onHover: (index: number) => void
}): ReactElement {
  const listRef = useRef<HTMLDivElement>(null)
  const below = anchor.bottom + 8
  const flip = below + 320 > window.innerHeight

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  return createPortal(
    <div
      aria-label="Add to the page"
      className="fixed z-50 w-60 overflow-hidden rounded-[14px] border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
      data-slot="slash-menu"
      role="listbox"
      style={{
        left: Math.min(anchor.left, window.innerWidth - 256),
        ...(flip ? { bottom: window.innerHeight - anchor.top + 8 } : { top: below }),
      }}
    >
      <div className="max-h-72 overflow-y-auto" ref={listRef}>
        {choices.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">Nothing matches</p>
        ) : (
          choices.map((choice: InsertChoice, index: number) => {
            const Icon = choice.icon
            const startsFields =
              choice.group === "fields" && choices[index - 1]?.group !== "fields"

            return (
              <div key={choice.id}>
                {startsFields ? (
                  <p className="px-2.5 pt-2 pb-1 text-xs text-muted-foreground">Fields</p>
                ) : null}
                <button
                  aria-selected={index === activeIndex}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-sm outline-none",
                    index === activeIndex && "bg-secondary text-secondary-foreground"
                  )}
                  data-index={index}
                  onMouseDown={(event) => {
                    // Keep the caret in the line, so choosing edits it.
                    event.preventDefault()
                    onChoose(choice)
                  }}
                  onMouseMove={() => onHover(index)}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  {choice.label}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>,
    document.body
  )
}
