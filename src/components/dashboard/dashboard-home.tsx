import { ChevronRight, FileText } from "lucide-react"
import Link from "next/link"
import type { ReactElement, ReactNode } from "react"

import {
  type ActivityRow,
  type DueTask,
  type QueueItem,
  type RecentFile,
  WORKFLOW_STAGES,
} from "@/components/dashboard/dashboard-view"
import { QueueList } from "@/components/dashboard/queue-list"
import { cn } from "@/lib/utils"
import type { SubmissionStatus } from "@/types/submission"

const ROW_LINK =
  "outline-none transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"

/** Where submissions stand, and whose they are. */
export type WorkflowSummary = Readonly<{ counts: Partial<Record<SubmissionStatus, number>>; scope: string }>

/**
 * The home page: everything waiting on the viewer, ranked, beside the week's
 * tasks, where submissions stand, and the latest files. A block the viewer's
 * role cannot see is left out rather than shown empty.
 *
 * @param props - What the page loaded; null for what the role cannot see.
 * @returns The dashboard's blocks.
 */
export function DashboardHome({
  activity,
  degraded,
  dueThisWeek,
  queue,
  recentFiles,
  workflow,
}: {
  activity: readonly ActivityRow[] | null
  /** True when something the page reads did not answer. */
  degraded: boolean
  dueThisWeek: readonly DueTask[] | null
  queue: readonly QueueItem[]
  recentFiles: readonly RecentFile[] | null
  workflow: WorkflowSummary | null
}): ReactElement {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
      <Block count={queue.length} title="Waiting on you">
        <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
          {queue.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              {degraded ? "Some of this didn't load." : "Nothing is waiting on you."}
            </p>
          ) : (
            <QueueList items={queue} />
          )}
          {degraded && queue.length > 0 ? (
            <p className="border-t border-border px-3.5 py-2.5 text-[13px] text-muted-foreground">
              Some of this didn&apos;t load.
            </p>
          ) : null}
        </div>
      </Block>

      <div className="grid gap-6">
        {dueThisWeek ? (
          <Block count={dueThisWeek.length} title="Due this week">
            {dueThisWeek.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is due this week.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-[14px] border border-border bg-card">
                {dueThisWeek.slice(0, 5).map((task: DueTask) => (
                  <li key={task.id}>
                    <Link
                      className={cn(ROW_LINK, "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5")}
                      href={task.href}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px]">{task.title}</span>
                        <span className="block text-xs text-muted-foreground">{task.assignee}</span>
                      </span>
                      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{task.due}</span>
                    </Link>
                  </li>
                ))}
                {dueThisWeek.length > 5 ? (
                  <li>
                    <Link className={cn(ROW_LINK, "block px-3.5 py-2.5 text-[13px] text-muted-foreground")} href="/tasks">
                      Show all in Tasks
                    </Link>
                  </li>
                ) : null}
              </ul>
            )}
          </Block>
        ) : null}

        {workflow ? <Workflow workflow={workflow} /> : null}

        {recentFiles ? (
          <Block title="Recent files">
            {recentFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No files yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentFiles.map((file: RecentFile, index: number) => (
                  <li className={cn(index >= 2 && "max-md:hidden")} key={file.id}>
                    <Link
                      className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2.5 py-2 text-[13px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                      href={file.href}
                    >
                      <FileText aria-hidden="true" className="row-span-2 mt-0.5 size-[18px] text-muted-foreground" />
                      <span className="truncate">{file.title}</span>
                      <span className="text-xs text-muted-foreground">{file.meta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        ) : null}

        {activity && activity.length > 0 ? (
          <details className="group max-md:hidden">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
              Recent activity
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
              />
            </summary>
            <ul className="mt-1.5 divide-y divide-border">
              {activity.map((row: ActivityRow) => (
                <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-[13px]" key={row.id}>
                  <span className="min-w-0 truncate">
                    {row.text}
                    {row.actor ? <span className="text-muted-foreground"> · {row.actor}</span> : null}
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">{row.when}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  )
}

function Block({
  children,
  count,
  scope,
  title,
}: {
  children: ReactNode
  count?: number
  scope?: string
  title: string
}): ReactElement {
  return (
    <section aria-label={title} className="grid min-w-0 content-start gap-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {count ? (
          <span className="rounded-full bg-secondary px-2 text-xs font-medium text-secondary-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        {scope ? <span className="ml-auto text-xs text-muted-foreground">{scope}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Workflow({ workflow }: { workflow: WorkflowSummary }): ReactElement {
  const stages = WORKFLOW_STAGES.filter((stage) => stage.status in workflow.counts).map((stage) => ({
    ...stage,
    count: workflow.counts[stage.status] ?? 0,
  }))
  const most = Math.max(1, ...stages.map((stage) => stage.count))

  return (
    <Block scope={workflow.scope} title="Workflow">
      <ul className="hidden gap-2.5 md:grid">
        {stages.map((stage) => (
          <li key={stage.status}>
            <Link
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13px] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40",
                stage.count === 0 && "text-muted-foreground"
              )}
              href={`/submissions?status=${stage.filter}`}
            >
              <span>{stage.label}</span>
              <span className="font-medium tabular-nums">{stage.count}</span>
              <span aria-hidden="true" className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full bg-primary",
                    stage.tone === "warn" && "bg-destructive",
                    stage.tone === "done" && "bg-success"
                  )}
                  style={{ width: `${Math.round((stage.count / most) * 100)}%` }}
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className="flex gap-2 overflow-x-auto pb-0.5 md:hidden">
        {stages.map((stage) => (
          <li className="flex-none" key={stage.status}>
            <Link
              className="grid min-w-[86px] rounded-[12px] border border-border bg-card px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              href={`/submissions?status=${stage.filter}`}
            >
              <span
                className={cn(
                  "text-lg font-medium tabular-nums",
                  stage.count > 0 && stage.tone === "warn" && "text-destructive",
                  stage.count > 0 && stage.tone === "done" && "text-success",
                  stage.count === 0 && "text-muted-foreground"
                )}
              >
                {stage.count}
              </span>
              <span className="text-[11px] text-muted-foreground">{stage.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  )
}
