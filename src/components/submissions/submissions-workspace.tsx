import { Plus, Search } from "lucide-react"
import Link from "next/link"
import type { CSSProperties, ReactElement } from "react"

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
import {
  SubmissionProgress,
  SubmissionStatusMark,
} from "@/components/submissions/submission-progress"
import { SubmissionTitlePreview } from "@/components/submissions/submission-title-preview"
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
// Below `lg` a row keeps its title and its track, and the rest folds away.
const GRID_WITH_ASSIGNEE =
  "lg:grid-cols-[minmax(14rem,1.6fr)_minmax(8.5rem,.8fr)_minmax(8rem,.7fr)_minmax(6rem,.5fr)]"
const GRID_WITHOUT_ASSIGNEE =
  "lg:grid-cols-[minmax(14rem,1.8fr)_minmax(8.5rem,.8fr)_minmax(6rem,.5fr)]"

/** Rows rise in one after another; later rows share the last step's delay. */
const MAX_STAGGERED_ROWS = 10
const ROW_STAGGER_MS = 25

/**
 * Renders the Submissions workspace in the People pattern: a quiet front with
 * search, status pills, and rows that lead with each submission's status and
 * show how far it has come, and every other tool — order, assignee, export —
 * kept behind the view menu until it is wanted.
 *
 * @param props - The current view, its page of submissions, members, and access.
 * @returns The Submissions workspace.
 */
export function SubmissionsWorkspace({
  canAssign,
  canCreate,
  currentUserId,
  members,
  organizationId,
  submissions,
  total,
  view,
}: {
  canAssign: boolean
  canCreate: boolean
  currentUserId: string
  members: OrganizationMember[]
  organizationId: string
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
        glide
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
              "hidden gap-4 px-3 py-2 text-[11px] font-normal tracking-[0.08em] text-muted-foreground uppercase lg:grid",
              grid
            )}
            role="row"
          >
            {/* Every row leads with its status mark, so the heading starts
                where the titles do. */}
            <span className="pl-[42px]" role="columnheader">
              Submission
            </span>
            <span role="columnheader">Progress</span>
            {canAssign ? <span role="columnheader">Assignee</span> : null}
            <span className="text-right" role="columnheader">
              Updated
            </span>
          </div>
          {submissions.map((submission: Submission, index: number) => (
            <SubmissionRow
              canAssign={canAssign}
              currentUserId={currentUserId}
              grid={grid}
              index={index}
              key={submission.id}
              members={members}
              organizationId={organizationId}
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
  index,
  members,
  organizationId,
  submission,
}: {
  canAssign: boolean
  currentUserId: string
  grid: string
  index: number
  members: OrganizationMember[]
  organizationId: string
  submission: Submission
}): ReactElement {
  const updated = formatMediumDate(submission.updatedAt)
  const riseDelay = {
    "--row-delay": `${Math.min(index, MAX_STAGGERED_ROWS) * ROW_STAGGER_MS}ms`,
  } as CSSProperties

  return (
    <div
      className={cn(
        "grid min-h-14 grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 rounded-[12px] px-1 py-2 transition-[background-color,translate] duration-200 hover:bg-card/65 data-[previewing=true]:bg-card/65 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:fill-mode-backwards motion-safe:[--tw-animation-delay:var(--row-delay)] motion-safe:hover:-translate-y-px lg:gap-4 lg:px-3",
        grid
      )}
      data-slot="submission-row"
      role="row"
      style={riseDelay}
    >
      <div className="flex min-w-0 items-center gap-3" role="cell">
        <SubmissionStatusMark status={submission.status} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <SubmissionTitlePreview
            href={`/submissions/${encodeURIComponent(submission.id)}`}
            organizationId={organizationId}
            submissionId={submission.id}
            title={submission.title}
          />
          <span
            className="text-xs text-muted-foreground tabular-nums lg:hidden"
            data-slot="submission-updated-compact"
          >
            <span className="sr-only">Updated </span>
            {updated}
          </span>
        </div>
      </div>
      <div className="min-w-0" data-slot="submission-status" role="cell">
        <SubmissionProgress status={submission.status} />
      </div>
      {canAssign ? (
        <span
          className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground lg:flex"
          data-slot="submission-assignee"
          role="cell"
        >
          <AssigneeInitials assignedTo={submission.assignedTo} members={members} />
          <span className="truncate">
            {formatMemberName(submission.assignedTo, members, currentUserId)}
          </span>
        </span>
      ) : null}
      <span
        className="hidden text-right text-sm text-muted-foreground tabular-nums lg:block"
        data-slot="submission-updated"
        role="cell"
      >
        {updated}
      </span>
    </div>
  )
}

// The name beside the circle is what gets read out, so the initials are drawn
// from an attribute and never become text of their own.
function AssigneeInitials({
  assignedTo,
  members,
}: {
  assignedTo: string | null
  members: OrganizationMember[]
}): ReactElement {
  const member = members.find(
    (candidate: OrganizationMember) => candidate.userId === assignedTo
  )

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-medium before:content-[attr(data-initials)]",
        assignedTo === null
          ? "border border-dashed border-border"
          : "bg-secondary text-secondary-foreground"
      )}
      data-initials={member ? getInitials(member.fullName || member.email) : ""}
    />
  )
}

function getInitials(name: string): string {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join("")
}
