import { Plus, Search } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

import { ListFilterChips } from "@/components/data/list-filter-chips"
import { ListPagination } from "@/components/data/list-pagination"
import { ListViewMenu } from "@/components/data/list-view-menu"
import { formatMemberName } from "@/components/people/member-name"
import {
  getSubmissionSearchFields,
  getSubmissionStatusOptions,
  getSubmissionViewMenuSections,
  isSubmissionViewAdjusted,
  submissionListState,
  type SubmissionListView,
} from "@/components/submissions/submission-list-view"
import { SubmissionStatusBadge } from "@/components/submissions/submission-status-badge"
import { buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatMediumDate } from "@/lib/date-format"
import { getLastPage } from "@/lib/list-state"
import { cn } from "@/lib/utils"
import type { OrganizationMember } from "@/types/organization"
import {
  SUBMISSION_SEARCH_MAX_LENGTH,
  type Submission,
} from "@/types/submission"

const SUBMISSIONS_PATH = "/submissions"

// People who assign reviews see an assignee column; everyone else does not.
const GRID_WITH_ASSIGNEE =
  "md:grid-cols-[minmax(16rem,1.6fr)_minmax(7rem,.6fr)_minmax(9rem,.8fr)_minmax(8rem,.7fr)]"
const GRID_WITHOUT_ASSIGNEE =
  "md:grid-cols-[minmax(16rem,1.8fr)_minmax(7rem,.6fr)_minmax(8rem,.7fr)]"

/**
 * Renders the Submissions workspace in the People pattern: a quiet front with
 * search, status pills, and title-first rows, and every other tool — order,
 * assignee, export — kept behind the view menu until it is wanted.
 *
 * @param props - The current view, its page of submissions, members, and access.
 * @returns The Submissions workspace.
 */
export function SubmissionsWorkspace({
  canAssign,
  canCreate,
  currentUserId,
  members,
  submissions,
  total,
  view,
}: {
  canAssign: boolean
  canCreate: boolean
  currentUserId: string
  members: OrganizationMember[]
  submissions: Submission[]
  total: number
  view: SubmissionListView
}): ReactElement {
  const lastPage = getLastPage(total, view.pageSize)
  const grid = canAssign ? GRID_WITH_ASSIGNEE : GRID_WITHOUT_ASSIGNEE

  return (
    <section className="flex flex-col gap-5" data-slot="submissions-workspace">
      {/* The real space keeps the accessible name "Submissions 12
          submissions" rather than "Submissions12 submissions". */}
      <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
        Submissions{" "}
        <span
          aria-label={`${total} ${total === 1 ? "submission" : "submissions"}`}
          className="ml-0.5 text-xl font-normal text-muted-foreground"
        >
          {total}
        </span>
      </h1>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
        <form action={SUBMISSIONS_PATH} className="min-w-0" role="search">
          {getSubmissionSearchFields(view).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <label className="relative block min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search submissions"
              className="h-11 rounded-[12px] bg-card pl-10 md:h-11"
              defaultValue={view.query}
              maxLength={SUBMISSION_SEARCH_MAX_LENGTH}
              name="q"
              placeholder="Search submissions…"
              type="search"
            />
          </label>
        </form>
        <ListViewMenu
          adjusted={isSubmissionViewAdjusted(view)}
          label="View options"
          sections={getSubmissionViewMenuSections(view, members, {
            canFilterAssignee: canAssign,
          })}
        />
        {canCreate ? (
          <Link
            className={cn(
              buttonVariants(),
              "h-11 rounded-[12px] px-4 font-normal"
            )}
            href="/submissions/new"
          >
            <Plus aria-hidden="true" data-icon="inline-start" />
            <span className="max-sm:sr-only">New submission</span>
          </Link>
        ) : null}
      </div>

      <ListFilterChips
        label="Filter submissions by status"
        options={getSubmissionStatusOptions(view)}
      />

      {submissions.length === 0 ? (
        // Outside the table: a table may only hold rows, and an empty list
        // is a message, not a row.
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          role="status"
        >
          {view.query || view.filters.status || view.filters.assignee
            ? "No submissions match this view."
            : "No submissions yet."}
        </p>
      ) : (
        <div
          aria-label="Submissions"
          className="flex flex-col gap-1"
          data-slot="submission-directory"
          role="table"
        >
          <div
            className={cn(
              "hidden gap-4 px-3 py-2 text-[11px] font-normal tracking-[0.08em] text-muted-foreground uppercase md:grid",
              grid
            )}
            role="row"
          >
            <span role="columnheader">Submission</span>
            <span role="columnheader">Status</span>
            {canAssign ? <span role="columnheader">Assignee</span> : null}
            <span role="columnheader">Updated</span>
          </div>
          {submissions.map((submission: Submission) => (
            <SubmissionRow
              canAssign={canAssign}
              currentUserId={currentUserId}
              grid={grid}
              key={submission.id}
              members={members}
              submission={submission}
            />
          ))}
        </div>
      )}

      <ListPagination
        nextHref={
          view.page < lastPage
            ? submissionListState.href(SUBMISSIONS_PATH, view, {
                page: view.page + 1,
              })
            : null
        }
        page={view.page}
        pageSize={view.pageSize}
        previousHref={
          view.page > 1
            ? submissionListState.href(SUBMISSIONS_PATH, view, {
                page: view.page - 1,
              })
            : null
        }
        total={total}
      />
    </section>
  )
}

function SubmissionRow({
  canAssign,
  currentUserId,
  grid,
  members,
  submission,
}: {
  canAssign: boolean
  currentUserId: string
  grid: string
  members: OrganizationMember[]
  submission: Submission
}): ReactElement {
  const updated = formatMediumDate(submission.updatedAt)

  return (
    <div
      className={cn(
        "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-1 py-2 transition-colors hover:bg-card/65 md:gap-4 md:px-3",
        grid
      )}
      data-slot="submission-row"
      role="row"
    >
      <div className="flex min-w-0 flex-col gap-0.5" role="cell">
        <Link
          className="w-fit max-w-full truncate rounded-[6px] text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/35"
          href={`/submissions/${encodeURIComponent(submission.id)}`}
        >
          {submission.title}
        </Link>
        <span
          className="text-xs text-muted-foreground tabular-nums md:hidden"
          data-slot="submission-updated-compact"
        >
          <span className="sr-only">Updated </span>
          {updated}
        </span>
      </div>
      <div
        className="justify-self-end md:justify-self-start"
        data-slot="submission-status"
        role="cell"
      >
        <SubmissionStatusBadge status={submission.status} />
      </div>
      {canAssign ? (
        <span
          className="hidden truncate text-sm text-muted-foreground md:block"
          data-slot="submission-assignee"
          role="cell"
        >
          {formatMemberName(submission.assignedTo, members, currentUserId)}
        </span>
      ) : null}
      <span
        className="hidden text-sm text-muted-foreground tabular-nums md:block"
        data-slot="submission-updated"
        role="cell"
      >
        {updated}
      </span>
    </div>
  )
}
