import type { ReactElement, ReactNode } from "react"

import {
  auditLogListState,
  formatAuditAction,
  getAuditKindOptions,
  getAuditViewMenuSections,
  isAuditViewAdjusted,
  type AuditLogView,
} from "@/components/audit/audit-log-view"
import { ListFilterChips } from "@/components/data/list-filter-chips"
import { ListPagination } from "@/components/data/list-pagination"
import { ListViewMenu } from "@/components/data/list-view-menu"
import { formatMediumDateTime } from "@/lib/date-format"
import { getLastPage } from "@/lib/list-state"
import type { AuditLogEntry } from "@/types/audit"
import type { OrganizationMember } from "@/types/organization"

const EVENT_GRID =
  "md:grid-cols-[minmax(16rem,1.4fr)_minmax(9rem,.8fr)_minmax(10rem,.8fr)]"

/**
 * Renders the audit log in the People pattern: events by name, actor, and
 * time, with each event's details folded away and the order and export kept
 * behind the view menu.
 *
 * @param props - The current view, its page of events, members, and the integrity mark.
 * @returns The audit log workspace.
 */
export function AuditLogWorkspace({
  entries,
  integrity,
  members,
  total,
  view,
}: {
  entries: AuditLogEntry[]
  /** Tamper-check mark shown beside the title, when the viewer may verify. */
  integrity: ReactNode
  members: OrganizationMember[]
  total: number
  view: AuditLogView
}): ReactElement {
  const lastPage = getLastPage(total, view.pageSize)

  return (
    <section className="flex flex-col gap-5" data-slot="audit-log-workspace">
      <div className="flex items-center justify-between gap-3">
        {/* The real space keeps the accessible name "Audit log 2 events". */}
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          Audit log{" "}
          <span
            aria-label={`${total} ${total === 1 ? "event" : "events"}`}
            className="ml-0.5 text-xl font-normal text-muted-foreground"
          >
            {total}
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {integrity}
          <ListViewMenu
            adjusted={isAuditViewAdjusted(view)}
            label="View options"
            sections={getAuditViewMenuSections(view)}
          />
        </div>
      </div>

      <ListFilterChips
        label="Filter events by kind"
        options={getAuditKindOptions(view)}
      />

      {entries.length === 0 ? (
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          role="status"
        >
          {view.filters.kind ? "No events of this kind." : "No events yet."}
        </p>
      ) : (
        <ul aria-label="Audit events" className="flex flex-col gap-1">
          {entries.map((entry: AuditLogEntry) => (
            <AuditEventRow entry={entry} key={entry.id} members={members} />
          ))}
        </ul>
      )}

      <ListPagination
        nextHref={
          view.page < lastPage
            ? auditLogListState.href("/audit-log", view, { page: view.page + 1 })
            : null
        }
        page={view.page}
        pageSize={view.pageSize}
        previousHref={
          view.page > 1
            ? auditLogListState.href("/audit-log", view, { page: view.page - 1 })
            : null
        }
        total={total}
      />
    </section>
  )
}

function AuditEventRow({
  entry,
  members,
}: {
  entry: AuditLogEntry
  members: OrganizationMember[]
}): ReactElement {
  return (
    <li data-slot="audit-event">
      <details className="rounded-[12px] transition-colors hover:bg-card/65 open:bg-card/65">
        <summary
          className={`grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-1 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/35 md:gap-4 md:px-3 [&::-webkit-details-marker]:hidden ${EVENT_GRID}`}
        >
          <span
            className="min-w-0 truncate text-sm font-medium text-foreground"
            data-slot="audit-event-name"
          >
            {formatAuditAction(entry.action)}
          </span>
          <span
            className="hidden truncate text-sm text-muted-foreground md:block"
            data-slot="audit-event-actor"
          >
            {formatAuditActor(entry.actorUserId, members)}
          </span>
          <time
            className="text-sm text-muted-foreground tabular-nums"
            dateTime={entry.createdAt}
          >
            {formatMediumDateTime(entry.createdAt)}
          </time>
        </summary>
        <dl className="grid gap-1 px-1 pb-3 text-xs md:px-3">
          {[
            ["By", formatAuditActor(entry.actorUserId, members)],
            ["Sequence", String(entry.seq)],
            ...Object.entries(entry.metadata).map(
              ([key, value]): [string, string] => [key, String(value)]
            ),
          ].map(([label, value]) => (
            <div className="flex min-w-0 gap-2" key={label}>
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  )
}

// A missing actor means the system recorded the event itself. An unknown one
// stays neutral: the member list may be unavailable to this viewer.
function formatAuditActor(
  actorUserId: string | null,
  members: OrganizationMember[]
): string {
  if (actorUserId === null) {
    return "System"
  }

  const member = members.find(
    (candidate: OrganizationMember): boolean => candidate.userId === actorUserId
  )

  return member?.fullName?.trim() || member?.email || "Member"
}
