import type { ReactElement, ReactNode } from "react"

import { type ListSavedViews, ListViewTitle } from "@/components/data/list-view-menu"
import { DatedTitle } from "@/components/navigation/dated-title"
import { cn } from "@/lib/utils"

/**
 * A list's title, or its saved views, with how many it holds and today's date
 * under it. The real space keeps the accessible name "Tasks 55 tasks" rather
 * than "Tasks55 tasks"; the small margin keeps the visual gap.
 *
 * @param props - The list's name, its views, its total, and what one item is called.
 * @returns The heading.
 */
export function ListHeading({
  noun,
  shrink = true,
  title,
  total,
  views,
}: {
  noun: readonly [one: string, many: string]
  /** The audit log's title has never carried `min-w-0`. */
  shrink?: boolean
  title: string
  total: number
  views: ListSavedViews
}): ReactElement {
  return (
    <DatedTitle>
      <h1 className={cn(shrink && "min-w-0", "text-2xl leading-none font-medium tracking-[-0.02em]")}>
        <ListViewTitle title={title} views={views} />{" "}
        <span
          aria-label={`${total} ${total === 1 ? noun[0] : noun[1]}`}
          className="ml-0.5 text-xl font-normal text-muted-foreground"
        >
          {total}
        </span>
      </h1>
    </DatedTitle>
  )
}

/**
 * Why a list shows nothing. Outside any table: an empty list is a message, not a row.
 *
 * @param props - The message.
 * @returns The message, announced.
 */
export function ListEmpty({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground" role="status">
      {children}
    </p>
  )
}
