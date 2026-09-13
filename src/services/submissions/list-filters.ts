import type { ListSort } from "@/lib/list-state"
import type { OrganizationRole } from "@/lib/permissions"
import { createListInputValidators } from "@/services/list-input"
import { escapeLikePattern } from "@/services/postgrest-paging"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  SUBMISSION_SEARCH_MAX_LENGTH,
  SUBMISSION_SORT_KEYS,
  SUBMISSION_STATUSES,
  type SubmissionSortKey,
  type SubmissionStatus,
} from "@/types/submission"

const MAX_SUBMISSION_PAGE_SIZE = 100
const DEFAULT_SUBMISSION_SORT: ListSort<SubmissionSortKey> = {
  direction: "desc",
  key: "updated",
}

/** Checks a submission page's untrusted page, page size, order, and search. */
export const SUBMISSION_LIST_INPUT = createListInputValidators({
  label: "Submission",
  maxPageSize: MAX_SUBMISSION_PAGE_SIZE,
  maxSearchLength: SUBMISSION_SEARCH_MAX_LENGTH,
  reject: (message: string): Error => new SubmissionServiceError(message, 400),
  sortKeys: SUBMISSION_SORT_KEYS,
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// External reviewers only ever see work assigned to them, once submitted.
const REVIEWER_VISIBLE_STATUSES: readonly SubmissionStatus[] = [
  "submitted",
  "in_review",
  "needs_changes",
  "approved",
  "rejected",
  "completed",
]

/** Who is asking, and which of their visible submissions a view shows. */
export type SubmissionListFilters = {
  actorUserId: string
  /** A member's user id, null for unassigned, or undefined for anyone. */
  assignedTo: string | null | undefined
  organizationId: string
  query: string | null
  role: OrganizationRole
  statuses: readonly SubmissionStatus[] | null
}

// Filters go through a minimal view of the query builder. Relating
// PostgREST's generated builder type to an interface makes the compiler give
// up (TS2589); every filter returns the same builder at runtime, so the
// caller's own type comes back unchanged.
type SubmissionFilterQuery = {
  eq(column: string, value: string): SubmissionFilterQuery
  ilike(column: string, pattern: string): SubmissionFilterQuery
  in(column: string, values: readonly string[]): SubmissionFilterQuery
  is(column: string, value: null): SubmissionFilterQuery
}

/**
 * Validates a view's untrusted filters for one actor.
 *
 * @param input - Actor, tenant, and optional view filters.
 * @param role - The actor's current organization role.
 * @returns Filters ready for `filterVisibleSubmissions`.
 * @throws SubmissionServiceError when a filter is not supported.
 */
export function createSubmissionListFilters(
  input: {
    actorUserId: string
    assignedTo?: string | null
    organizationId: string
    query?: string
    statuses?: readonly string[]
  },
  role: OrganizationRole
): SubmissionListFilters {
  return {
    actorUserId: input.actorUserId,
    assignedTo: normalizeSubmissionAssignee(input.assignedTo),
    organizationId: input.organizationId,
    query: SUBMISSION_LIST_INPUT.search(input.query),
    role,
    statuses: normalizeSubmissionStatusFilter(input.statuses),
  }
}

/**
 * Narrows a submissions query to what the actor may see, then to the view.
 *
 * Owners and managers see every organization submission, staff see the ones
 * they created, and external reviewers see their assigned non-drafts.
 *
 * @param query - A submissions query builder.
 * @param filters - Validated actor scope and view filters.
 * @returns The same builder, filtered.
 */
export function filterVisibleSubmissions<TQuery>(
  query: TQuery,
  filters: SubmissionListFilters
): TQuery {
  let filtered = (query as unknown as SubmissionFilterQuery).eq(
    "org_id",
    filters.organizationId
  )

  if (filters.role === "staff") {
    filtered = filtered.eq("created_by", filters.actorUserId)
  } else if (filters.role === "external_reviewer") {
    filtered = filtered
      .eq("assigned_to", filters.actorUserId)
      .in("status", REVIEWER_VISIBLE_STATUSES)
  }

  if (filters.statuses !== null) {
    filtered = filtered.in("status", filters.statuses)
  }

  if (filters.assignedTo === null) {
    filtered = filtered.is("assigned_to", null)
  } else if (filters.assignedTo !== undefined) {
    filtered = filtered.eq("assigned_to", filters.assignedTo)
  }

  if (filters.query !== null) {
    filtered = filtered.ilike("title", `%${escapeLikePattern(filters.query)}%`)
  }

  return filtered as unknown as TQuery
}

/**
 * Validates an untrusted list order; none means most recently updated first.
 *
 * @param value - Untrusted sort key and direction.
 * @returns The validated order.
 * @throws SubmissionServiceError when the key or direction is not supported.
 */
export function normalizeSubmissionSort(
  value: ListSort<string> | undefined
): ListSort<SubmissionSortKey> {
  return value === undefined
    ? DEFAULT_SUBMISSION_SORT
    : SUBMISSION_LIST_INPUT.sort(value)
}

function normalizeSubmissionAssignee(
  value: string | null | undefined
): string | null | undefined {
  if (value === null || value === undefined) {
    return value
  }

  if (!UUID_PATTERN.test(value)) {
    throw new SubmissionServiceError(
      "Submission assignee filter must be a valid user id.",
      400
    )
  }

  return value
}

function normalizeSubmissionStatusFilter(
  value: readonly string[] | undefined
): SubmissionStatus[] | null {
  const statuses = Array.from(new Set(value ?? []))

  if (statuses.length === 0) {
    return null
  }

  if (
    statuses.some(
      (status: string): boolean =>
        !SUBMISSION_STATUSES.includes(status as SubmissionStatus)
    )
  ) {
    throw new SubmissionServiceError(
      "Submission status filter is not supported.",
      400
    )
  }

  return statuses as SubmissionStatus[]
}
