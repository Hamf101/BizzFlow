import { z } from "zod"

import type {
  ListOption,
  ListOptionSection,
} from "@/components/data/list-option"
import {
  defineListState,
  formatListSort,
  type ListSort,
} from "@/lib/list-state"
import type { OrganizationMember } from "@/types/organization"
import {
  SUBMISSION_SEARCH_MAX_LENGTH,
  SUBMISSION_SORT_KEYS,
  type SubmissionSortKey,
  type SubmissionStatus,
} from "@/types/submission"

const SUBMISSIONS_PATH = "/submissions"
const SUBMISSIONS_EXPORT_PATH = "/api/export/submissions"
const UNASSIGNED = "unassigned"

const SUBMISSION_STATUS_FILTER_KEYS = [
  "draft",
  "submitted",
  "in_review",
  "needs_changes",
  "decided",
] as const

type SubmissionStatusFilter = (typeof SUBMISSION_STATUS_FILTER_KEYS)[number]

// Each pill stands for one or more lifecycle states. Approved, rejected, and
// completed share one, so the row of pills stays short.
const SUBMISSION_STATUS_FILTERS: Record<
  SubmissionStatusFilter,
  { label: string; statuses: readonly SubmissionStatus[] }
> = {
  decided: { label: "Decided", statuses: ["approved", "rejected", "completed"] },
  draft: { label: "Drafts", statuses: ["draft"] },
  in_review: { label: "In review", statuses: ["in_review"] },
  needs_changes: { label: "Needs changes", statuses: ["needs_changes"] },
  submitted: { label: "Submitted", statuses: ["submitted"] },
}

/** The Submissions page's URL state; unknown or stale values open the default view. */
export const submissionListState = defineListState({
  filters: {
    assignee: z.union([z.literal(UNASSIGNED), z.string().uuid()]),
    status: z.enum(SUBMISSION_STATUS_FILTER_KEYS),
  },
  pageSizes: [50, 25, 100],
  search: { maxLength: SUBMISSION_SEARCH_MAX_LENGTH },
  sort: {
    default: { direction: "desc", key: "updated" },
    keys: SUBMISSION_SORT_KEYS,
  },
})

/** One validated Submissions view. */
export type SubmissionListView = ReturnType<typeof submissionListState.parse>

const DEFAULT_SUBMISSION_VIEW = submissionListState.parse({})

const SUBMISSION_SORT_OPTIONS: ReadonlyArray<{
  label: string
  sort: ListSort<SubmissionSortKey>
}> = [
  { label: "Recently updated", sort: { direction: "desc", key: "updated" } },
  { label: "Least recently updated", sort: { direction: "asc", key: "updated" } },
  { label: "Newest first", sort: { direction: "desc", key: "created" } },
  { label: "Oldest first", sort: { direction: "asc", key: "created" } },
  { label: "Title, A to Z", sort: { direction: "asc", key: "title" } },
  { label: "Title, Z to A", sort: { direction: "desc", key: "title" } },
]

/**
 * Reads the lifecycle states a view's status pill stands for.
 *
 * @param view - Current Submissions view.
 * @returns The pill's states, or undefined when every status is shown.
 */
export function getSubmissionViewStatuses(
  view: SubmissionListView
): readonly SubmissionStatus[] | undefined {
  return view.filters.status
    ? SUBMISSION_STATUS_FILTERS[view.filters.status].statuses
    : undefined
}

/**
 * Reads the assignee a view filters to.
 *
 * @param view - Current Submissions view.
 * @returns A member's user id, null for unassigned, or undefined for anyone.
 */
export function getSubmissionViewAssignee(
  view: SubmissionListView
): string | null | undefined {
  return view.filters.assignee === UNASSIGNED ? null : view.filters.assignee
}

/**
 * Lists the status pills, each a link that keeps the rest of the view.
 *
 * @param view - Current Submissions view.
 * @returns "All" followed by one option per status group.
 */
export function getSubmissionStatusOptions(
  view: SubmissionListView
): ListOption[] {
  return [
    {
      href: submissionListState.href(SUBMISSIONS_PATH, view, {
        filters: { status: undefined },
      }),
      label: "All",
      selected: view.filters.status === undefined,
    },
    ...SUBMISSION_STATUS_FILTER_KEYS.map(
      (status: SubmissionStatusFilter): ListOption => ({
        href: submissionListState.href(SUBMISSIONS_PATH, view, {
          filters: { status },
        }),
        label: SUBMISSION_STATUS_FILTERS[status].label,
        selected: view.filters.status === status,
      })
    ),
  ]
}

/**
 * Lists the settings kept behind the view menu: order, assignee for people
 * who assign reviews, and the export of the whole view.
 *
 * @param view - Current Submissions view.
 * @param members - Members a review can be assigned to.
 * @param options - Whether the viewer assigns reviews.
 * @returns The Sort, optional Assignee, and Export sections.
 */
export function getSubmissionViewMenuSections(
  view: SubmissionListView,
  members: readonly OrganizationMember[],
  options: { canFilterAssignee: boolean }
): ListOptionSection[] {
  const sort: ListOptionSection = {
    label: "Sort",
    options: SUBMISSION_SORT_OPTIONS.map(
      ({ label, sort: option }): ListOption => ({
        href: submissionListState.href(SUBMISSIONS_PATH, view, { sort: option }),
        label,
        selected: formatListSort(view.sort) === formatListSort(option),
      })
    ),
  }
  const exportSection: ListOptionSection = {
    label: "Export",
    options: [
      {
        download: true,
        href: submissionListState.href(SUBMISSIONS_EXPORT_PATH, view, {
          page: 1,
          pageSize: DEFAULT_SUBMISSION_VIEW.pageSize,
        }),
        label: "Download CSV",
        selected: false,
      },
    ],
  }

  if (!options.canFilterAssignee) {
    return [sort, exportSection]
  }

  const assignee: ListOptionSection = {
    label: "Assignee",
    options: [
      {
        href: submissionListState.href(SUBMISSIONS_PATH, view, {
          filters: { assignee: undefined },
        }),
        label: "Anyone",
        selected: view.filters.assignee === undefined,
      },
      {
        href: submissionListState.href(SUBMISSIONS_PATH, view, {
          filters: { assignee: UNASSIGNED },
        }),
        label: "Unassigned",
        selected: view.filters.assignee === UNASSIGNED,
      },
      ...members.map(
        (member: OrganizationMember): ListOption => ({
          href: submissionListState.href(SUBMISSIONS_PATH, view, {
            filters: { assignee: member.userId },
          }),
          label: member.fullName?.trim() || member.email,
          selected: view.filters.assignee === member.userId,
        })
      ),
    ],
  }

  return [sort, assignee, exportSection]
}

/**
 * Reports whether a setting that only the view menu shows differs from the
 * default, so the menu can say so.
 *
 * @param view - Current Submissions view.
 * @returns True when the assignee, order, or page size is not the default.
 */
export function isSubmissionViewAdjusted(view: SubmissionListView): boolean {
  return (
    view.filters.assignee !== undefined ||
    formatListSort(view.sort) !== formatListSort(DEFAULT_SUBMISSION_VIEW.sort) ||
    view.pageSize !== DEFAULT_SUBMISSION_VIEW.pageSize
  )
}

/**
 * Lists the fields a new search carries over: everything except the old
 * query and the page, so the search starts on page one of the same view.
 *
 * @param view - Current Submissions view.
 * @returns Name and value pairs for hidden form fields.
 */
export function getSubmissionSearchFields(
  view: SubmissionListView
): Array<[name: string, value: string]> {
  return Array.from(
    submissionListState.toSearchParams({ ...view, page: 1, query: "" }).entries()
  )
}
