"use client"

import { type ReactElement, type ReactNode, useSyncExternalStore } from "react"

import { cn } from "@/lib/utils"

const TODAY = new Intl.DateTimeFormat("en", { day: "numeric", month: "long", weekday: "long", year: "numeric" })

/** Checks each minute, so a tab left open past midnight turns over to the new day. */
function subscribeToClock(onChange: () => void): () => void {
  const timer = setInterval(onChange, 60_000)
  return () => clearInterval(timer)
}

/**
 * A workspace page's title with today's date under it, in the reader's own time zone.
 * The server can't know that zone, so it leaves the line empty and the browser fills it in.
 * @param props - The page's heading, and classes for its place in the header.
 * @returns The heading over a line such as "Monday, September 28, 2026".
 */
export function DatedTitle({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  const today = useSyncExternalStore(subscribeToClock, () => TODAY.format(new Date()), () => "")

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {children}
      {/* One line tall while it waits, so the page never shifts when the date arrives. */}
      <p className="min-h-[1lh] text-[13px] text-muted-foreground">{today}</p>
    </div>
  )
}
