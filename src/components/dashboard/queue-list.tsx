"use client"

import { ChevronRight, Clock, FileText, Inbox, type LucideIcon, MessageSquare, PenLine } from "lucide-react"
import Link from "next/link"
import { type ReactElement, useState } from "react"

import type { QueueItem, QueueKind, QueueTone } from "@/components/dashboard/dashboard-view"
import { cn } from "@/lib/utils"

const QUEUE_LIMIT = 8
const PHONE_QUEUE_LIMIT = 4

const ROW =
  "outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"

const KIND_ICONS: Record<QueueKind, LucideIcon> = {
  "Awaiting signatures": PenLine,
  Draft: FileText,
  "Needs changes": MessageSquare,
  "Overdue task": Clock,
  Review: Inbox,
}

const TONE_ICON: Record<QueueTone, string> = {
  critical: "bg-destructive/12 text-destructive",
  quiet: "bg-muted text-muted-foreground",
  you: "bg-primary/12 text-primary",
}

const TONE_TEXT: Record<QueueTone, string> = {
  critical: "text-destructive",
  quiet: "text-muted-foreground",
  you: "text-primary",
}

/**
 * The ranked rows waiting on the viewer: the first page of them, and the rest
 * one press away, so a long day never hides work behind the count.
 *
 * @param props - The rows, already in the order to act on them.
 * @returns The list.
 */
export function QueueList({ items }: { items: readonly QueueItem[] }): ReactElement {
  const [all, setAll] = useState(false)

  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((item: QueueItem, index: number) => (
          <QueueRow
            hidden={!all && index >= QUEUE_LIMIT}
            hideOnPhone={!all && index >= PHONE_QUEUE_LIMIT}
            item={item}
            key={`${item.kind}-${item.id}`}
          />
        ))}
      </ul>
      {!all && items.length > PHONE_QUEUE_LIMIT ? (
        <button
          className={cn(
            ROW,
            "w-full border-t border-border px-3.5 py-2.5 text-left text-[13px] text-muted-foreground",
            items.length <= QUEUE_LIMIT && "md:hidden"
          )}
          onClick={() => setAll(true)}
          type="button"
        >
          Show all {items.length}
        </button>
      ) : null}
    </>
  )
}

function QueueRow({ hidden, hideOnPhone, item }: { hidden: boolean; hideOnPhone: boolean; item: QueueItem }): ReactElement {
  const Icon = KIND_ICONS[item.kind]
  const when = cn("text-[13px] text-muted-foreground tabular-nums", item.tone === "critical" && "text-destructive")

  return (
    <li className={cn(hideOnPhone && "max-md:hidden")} hidden={hidden}>
      <Link
        className={cn(
          ROW,
          "group/row",
          "grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 md:grid-cols-[34px_minmax(0,1fr)_auto] md:gap-3 md:px-3.5 md:py-3"
        )}
        href={item.href}
      >
        <span className={cn("grid size-[30px] place-items-center rounded-[10px] md:size-[34px]", TONE_ICON[item.tone])}>
          <Icon aria-hidden="true" className="size-[15px] md:size-[17px]" />
        </span>
        <span className="grid min-w-0">
          <span className={cn("text-[11px] font-semibold tracking-[0.06em] uppercase", TONE_TEXT[item.tone])}>
            {item.kind}
          </span>
          <span className="truncate text-sm font-medium">{item.title}</span>
          {item.context ? <span className="truncate text-[13px] text-muted-foreground">{item.context}</span> : null}
          <span className={cn(when, "md:hidden")}>{item.when}</span>
        </span>
        {/* The date gives way to the row's action while it is pointed at. */}
        <span className="hidden items-center justify-items-end md:grid">
          <span
            className={cn(
              when,
              "whitespace-nowrap transition-opacity [grid-area:1/1] group-hover/row:opacity-0 group-focus-visible/row:opacity-0"
            )}
          >
            {item.when}
          </span>
          <span
            aria-hidden="true"
            className="rounded-[10px] border border-border bg-card px-3 py-1.5 text-[13px] font-medium whitespace-nowrap opacity-0 transition-opacity [grid-area:1/1] group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
          >
            {item.action}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground md:hidden" />
      </Link>
    </li>
  )
}
