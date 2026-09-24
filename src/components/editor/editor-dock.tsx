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

/** Which way the dock runs: a column, or a row. */
export type DockOrientation = "upright" | "flat"

/**
 * The editor's tools in a slim floating dock, upright or flat, wherever the
 * editor places it. Each tool opens beside the dock and closes when it has
 * done its job, so the page stays clear.
 *
 * @param props - The tools, which way the dock runs, and whether the screen is phone-narrow.
 * @returns The dock.
 */
export function EditorDock({
  narrow,
  orientation,
  tools,
}: {
  narrow: boolean
  orientation: DockOrientation
  tools: readonly DockTool[]
}): ReactElement {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <nav
      aria-label="Editor tools"
      className={cn(
        "flex gap-1 rounded-[16px] border border-border bg-popover p-1.5 shadow-lg",
        orientation === "upright" && "flex-col"
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
          "relative grid size-11 place-items-center rounded-[12px] text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-secondary data-popup-open:text-secondary-foreground"

        if (!tool.content) {
          return (
            <button
              aria-label={tool.label}
              className={cn(buttonClass, !narrow && "size-10")}
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
              className={cn(buttonClass, !narrow && "size-10")}
              title={tool.label}
            >
              {face}
            </PopoverTrigger>
            <PopoverContent
              align="center"
              className={cn(tool.wide ? "w-[min(26rem,calc(100vw-2rem))]" : "w-[min(19rem,calc(100vw-2rem))]")}
              side={orientation === "upright" ? "right" : "top"}
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
