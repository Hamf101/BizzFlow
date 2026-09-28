"use client"

import type { LucideIcon } from "lucide-react"
import { type ReactElement, type ReactNode, useState } from "react"

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** One tool in the dock: its icon, its name, and the panel it opens. */
export type DockTool = Readonly<{
  badge?: number
  /** The panel it opens beside the dock. */
  content: (close: () => void) => ReactNode
  icon: LucideIcon
  id: string
  label: string
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
  lead,
  narrow,
  orientation,
  tools,
}: {
  /** Tools that come first, such as the formatting toolbar on a phone. */
  lead?: ReactNode
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
        orientation === "upright" && "flex-col",
        // On a phone the row runs off the screen's right edge, which shows it scrolls.
        narrow && "max-w-full items-center overflow-x-auto rounded-r-none border-r-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
      data-slot="editor-dock"
    >
      {lead ? (
        <>
          {lead}
          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
        </>
      ) : null}
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
          "relative grid size-11 shrink-0 place-items-center rounded-[12px] text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 data-popup-open:bg-secondary data-popup-open:text-secondary-foreground"

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
