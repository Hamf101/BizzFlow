import type { ReactElement } from "react"

/**
 * Instant skeleton shown inside the dashboard panel while a page's server data
 * loads, so navigation feels immediate instead of frozen on the previous page.
 *
 * @returns A pulsing placeholder that mirrors the standard page layout.
 */
export default function DashboardLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Loading">
      <div className="flex flex-col gap-2.5">
        <div className="h-7 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted/70" />
      </div>
      <div className="h-40 animate-pulse rounded-[14px] border border-border/60 bg-card" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-48 animate-pulse rounded-[14px] border border-border/60 bg-card" />
        <div className="h-48 animate-pulse rounded-[14px] border border-border/60 bg-card" />
      </div>
      <span className="sr-only">Loading page</span>
    </div>
  )
}
