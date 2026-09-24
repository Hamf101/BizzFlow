"use client"

import type { LucideIcon } from "lucide-react"
import { type ReactElement, type ReactNode, useState } from "react"

import type { InsertChoice } from "@/components/editor/block-catalog"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** One tool in the dock: its icon, its name, and the panel it opens. */
export type DockTool = Readonly<{
  badge?: number
  /** The panel it opens beside the dock. */
  content?: (close: () => void) => ReactNode
  icon: LucideIcon
  id: string
  label: string
  /** Opens something of the editor's own instead, such as Flow's side panel. */
  onOpen?: () => void
  wide?: boolean
}>

/**
 * The editor's tools in a slim floating dock: down the left of the canvas on
 * a laptop, along the bottom on a phone. Each tool opens beside the dock and
 * closes when it has done its job, so the page stays clear.
 *
 * @param props - The tools, and whether the screen is phone-narrow.
 * @returns The dock.
 */
export function EditorDock({ narrow, tools }: { narrow: boolean; tools: readonly DockTool[] }): ReactElement {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <nav
      aria-label="Editor tools"
      className={cn(
        "absolute z-20 flex gap-1 rounded-[16px] border border-border bg-popover p-1.5 shadow-lg",
        narrow
          ? "bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2"
          : "top-1/2 left-4 -translate-y-1/2 flex-col"
      )}
      data-slot="editor-dock"
    >
      {tools.map((tool: DockTool) => {
        const Icon = tool.icon
        const close = () => setOpen(null)
        const face = (
          <>
            <Icon aria-hidden="true" className="size-[19px]" />
            {tool.badge ? (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] leading-4 text-destructive-foreground"
              >
                {tool.badge}
              </span>
            ) : null}
          </>
        )
        const buttonClass =
          "relative grid size-11 place-items-center rounded-[12px] text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-secondary data-popup-open:text-secondary-foreground md:size-10"

        if (!tool.content) {
          return (
            <button
              aria-label={tool.label}
              className={buttonClass}
              key={tool.id}
              onClick={tool.onOpen}
              title={tool.label}
              type="button"
            >
              {face}
            </button>
          )
        }

        const content = tool.content

        return (
          <Popover
            key={tool.id}
            onOpenChange={(next: boolean) => setOpen(next ? tool.id : null)}
            open={open === tool.id}
          >
            <PopoverTrigger
              aria-label={tool.badge ? `${tool.label}, ${tool.badge}` : tool.label}
              className={buttonClass}
              title={tool.label}
            >
              {face}
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className={cn(tool.wide ? "w-[min(26rem,calc(100vw-2rem))]" : "w-[min(19rem,calc(100vw-2rem))]")}
              side={narrow ? "top" : "right"}
              sideOffset={12}
            >
              <PopoverTitle className="px-1 pb-2.5 text-sm font-medium">{tool.label}</PopoverTitle>
              {content(close)}
            </PopoverContent>
          </Popover>
        )
      })}
    </nav>
  )
}

/**
 * Tiles for adding to the page, each with its icon and a short name.
 *
 * @param props - The choices and what choosing does.
 * @returns A grid of tiles.
 */
export function InsertTiles({
  choices,
  onChoose,
}: {
  choices: readonly InsertChoice[]
  onChoose: (choice: InsertChoice) => void
}): ReactElement {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {choices.map((choice: InsertChoice) => {
        const Icon = choice.icon

        return (
          <button
            className="grid min-h-[4.5rem] content-center justify-items-center gap-1.5 rounded-[12px] bg-muted/60 px-1.5 py-2.5 text-center text-xs leading-tight text-foreground/85 outline-none transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            key={choice.id}
            onClick={() => onChoose(choice)}
            type="button"
          >
            <Icon aria-hidden="true" className="size-[18px] text-primary" />
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}
