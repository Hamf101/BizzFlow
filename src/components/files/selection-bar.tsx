"use client"

import { FolderInput, X } from "lucide-react"
import { type ReactElement, useLayoutEffect, useState } from "react"

import {
  ACTION_ICONS,
  describeBulk,
  type FileLifecycleAction,
  useSelectionChanges,
} from "@/components/files/file-row-menu"
import { useFileSelection } from "@/components/files/file-selection"
import { MoveToDialog } from "@/components/files/move-to-dialog"
import { cn } from "@/lib/utils"

type Shown = { count: number; labels: FileLifecycleAction["label"][] }

const BUTTON =
  "grid h-9 shrink-0 grid-flow-col place-items-center gap-2 rounded-full px-2.5 outline-none transition-colors hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-background/50 md:px-3.5"

/**
 * While anything is selected, floats its count, the changes every selected
 * item allows, and a cross that clears it, in a bar at the bottom of the
 * screen. The bar rises in with the first item and sinks away with the last,
 * so nothing on the page moves. On a phone it floats above the tabs and names
 * each change with an icon.
 *
 * @returns The selection bar.
 */
export function SelectionBar(): ReactElement {
  const selection = useFileSelection()
  const targets = selection
    ? selection.items.filter((item) => selection.selected.has(item.id))
    : []
  const open = targets.length > 0
  const { labels, run } = useSelectionChanges(open ? targets : null)
  const [moving, setMoving] = useState(false)
  // Only active items move, which is exactly where Archive is offered.
  const moves = labels.includes("Archive")
  // What the bar last showed, so it keeps its words while it sinks away.
  const [shown, setShown] = useState<Shown>({ count: 0, labels: [] })

  // Centred over the page's panel rather than the window, which also holds
  // the sidebar.
  const [center, setCenter] = useState<number>()

  if (open && (shown.count !== targets.length || shown.labels.join() !== labels.join())) {
    setShown({ count: targets.length, labels })
  }

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
        {shown.count} selected
      </p>
      {moves ? (
        <button
          aria-label={`Move ${shown.count} ${shown.count === 1 ? "item" : "items"}`}
          className={BUTTON}
          onClick={() => setMoving(true)}
          type="button"
        >
          <FolderInput aria-hidden="true" className="size-4 opacity-80" />
          <span className="max-md:hidden">Move</span>
        </button>
      ) : null}
      {shown.labels.map((label: FileLifecycleAction["label"]) => {
        const Icon = ACTION_ICONS[label]

        return (
          <button
            aria-label={describeBulk(label, shown.count)}
            className={BUTTON}
            key={label}
            onClick={() => run(label)}
            type="button"
          >
            <Icon aria-hidden="true" className="size-4 opacity-80" />
            <span className="max-md:hidden">{label}</span>
          </button>
        )
      })}
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-background/30" />
      <button
        aria-label="Clear selection"
        className={cn(BUTTON, "px-0 md:px-0 size-9")}
        onClick={selection?.clear}
        type="button"
      >
        <X aria-hidden="true" className="size-4 opacity-85" />
      </button>
      {selection && moves ? (
        <MoveToDialog
          destinations={selection.destinations}
          folderId={selection.folderId}
          items={targets}
          onOpenChange={setMoving}
          open={moving}
        />
      ) : null}
    </div>
  )
}
