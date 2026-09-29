"use client"

import { X } from "lucide-react"
import { type ReactElement, type ReactNode, useLayoutEffect, useState } from "react"

import { cn } from "@/lib/utils"

/** The look of a button on the selection bar, shared by every workspace. */
export const BAR_BUTTON =
  "grid h-9 shrink-0 grid-flow-col place-items-center gap-2 rounded-full px-2.5 outline-none transition-colors hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background/50 md:px-3.5"

/**
 * While anything is selected, floats its count, the changes every selected
 * item allows, and a cross that clears it, in a bar at the bottom of the
 * screen. The bar rises in with the first item and sinks away with the last,
 * so nothing on the page moves. On a phone it floats above the tabs.
 *
 * @param props - Whether anything is selected, how many, what clears it, and the buttons.
 * @returns The selection bar.
 */
export function SelectionBarShell({
  children,
  count,
  onClear,
  open,
}: {
  children: ReactNode
  count: number
  onClear: (() => void) | undefined
  open: boolean
}): ReactElement {
  // Centred over the page's panel rather than the window, which also holds
  // the sidebar.
  const [center, setCenter] = useState<number>()

  // ponytail: measured when the bar opens and on window resizes; a sidebar
  // toggled while it is open moves the panel without moving the bar.
  useLayoutEffect(() => {
    const panel = document.querySelector("main")

    if (!open || !panel) {
      return
    }

    function measure(): void {
      const { left, width } = (panel as HTMLElement).getBoundingClientRect()
      setCenter(left + width / 2)
    }

    measure()
    window.addEventListener("resize", measure)

    return () => window.removeEventListener("resize", measure)
  }, [open])

  return (
    <div
      aria-hidden={!open}
      aria-label="Selection"
      className={cn(
        "fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-foreground py-1 pr-1 pl-5 text-sm whitespace-nowrap text-background shadow-xl transition-[translate,opacity,visibility] duration-200 ease-out md:bottom-6",
        !open && "invisible translate-y-4 opacity-0"
      )}
      data-slot="selection-bar"
      role="group"
      style={center === undefined ? undefined : { left: center }}
    >
      <p aria-live="polite" className="mr-2 font-medium">
        {count} selected
      </p>
      {children}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-background/30" />
      <button
        aria-label="Clear selection"
        className={cn(BAR_BUTTON, "px-0 md:px-0 size-9")}
        onClick={onClear}
        type="button"
      >
        <X aria-hidden="true" className="size-4 opacity-85" />
      </button>
    </div>
  )
}
