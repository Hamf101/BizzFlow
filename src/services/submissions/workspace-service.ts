import { getOrganizationRoleFromSubject } from "@/lib/permissions"
import { readCountedPage } from "@/services/postgrest-paging"
import type {
  CountSubmissionsByStatusInput,
  GetInternalSubmissionInput,
  ListSubmissionPageInput,
  SubmissionDetail,
  SubmissionPage,
  SubmissionPreview,
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import {
  createSubmissionListFilters,
  filterVisibleSubmissions,
  normalizeSubmissionSort,
  SUBMISSION_LIST_INPUT,
  type SubmissionListFilters,
} from "@/services/submissions/list-filters"
import { listSubmissionReviewData } from "@/services/submissions/review-service"
import {
  assertSubmissionVisible,
  createSubmissionDatabaseError,
  getSubmissionById,
  getSubmissionClient,
  listSubmissionFiles,
  requireSubmissionPermission,
  runSubmissionOperation,
  SUBMISSION_COLUMNS,
} from "@/services/submissions/shared"
import {
  parseSubmissionRow,
  type Submission,
  type SubmissionSortKey,
  type SubmissionStatus,
} from "@/types/submission"

// Every ordering ends with the id, so submissions with equal values still
// page deterministically: an offset boundary never repeats or skips one.
const SUBMISSION_PAGE_ORDERS: Record<
  SubmissionSortKey,
  (ascending: boolean) => ReadonlyArray<{ ascending: boolean; column: string }>
> = {
  created: (ascending: boolean) => [
    { ascending, column: "created_at" },
    { ascending: true, column: "id" },
  ],
  title: (ascending: boolean) => [
    { ascending, column: "title" },
    { ascending: true, column: "id" },
  ],
  updated: (ascending: boolean) => [
    { ascending, column: "updated_at" },
    { ascending: true, column: "id" },
  ],
}

/**
 * Lists one page of the submissions an actor may see, searched, filtered,
 * and sorted by a view.
 *
 * @param input - Actor, tenant, page, order, and view filters.
 * @param deps - Optional trusted database dependency.
 * @returns The page's submissions and how many match the view.
 * @throws SubmissionServiceError when access, validation, or a read fails.
 */
export async function listSubmissionPage(
  input: ListSubmissionPageInput,
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionPage> {
  return runSubmissionOperation(
    "list_submission_page",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      page: input.page,
      pageSize: input.pageSize,
    },
    async (): Promise<SubmissionPage> => {
      const client = getSubmissionClient(deps)
      const permissionSubject = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot view internal submissions."
      )
      const page = SUBMISSION_LIST_INPUT.page(input.page)
      const pageSize = SUBMISSION_LIST_INPUT.pageSize(input.pageSize)
      const sort = normalizeSubmissionSort(input.sort)
      const filters = createSubmissionListFilters(
        input,
        getOrganizationRoleFromSubject(permissionSubject)
      )
      let query = filterVisibleSubmissions(
        client.from("submissions").select(SUBMISSION_COLUMNS, { count: "exact" }),
        filters
      )

      for (const order of SUBMISSION_PAGE_ORDERS[sort.key](
        sort.direction === "asc"
      )) {
        query = query.order(order.column, { ascending: order.ascending })
      }

      const from = (page - 1) * pageSize
      const { rows, total } = await readCountedPage(
        await query.range(from, from + pageSize - 1),
        () => countVisibleSubmissions(client, filters),
        (error: unknown): Error =>
          createSubmissionDatabaseError(error, "Unable to load internal submissions.")
      )

      return { page, pageSize, submissions: rows.map(parseSubmissionRow), total }
    }
  )
}

/**
 * Counts the submissions an actor may see in each of the given statuses, so a
 * glance shows where work stands without loading any of it.
 *
 * @param input - Actor, tenant, the statuses to count, and optionally a moment
 *   before which updates are left out.
 * @param deps - Optional trusted database dependency.
 * @returns How many visible submissions sit in each status.
 * @throws SubmissionServiceError when access or a read fails.
 */
export async function countSubmissionsByStatus(
  input: CountSubmissionsByStatusInput,
  deps: SubmissionServiceDeps = {}
): Promise<Partial<Record<SubmissionStatus, number>>> {
  return runSubmissionOperation(
    "count_submissions_by_status",
    { actorUserId: input.actorUserId, organizationId: input.organizationId },
    async (): Promise<Partial<Record<SubmissionStatus, number>>> => {
      const client = getSubmissionClient(deps)
      const role = getOrganizationRoleFromSubject(
        await requireSubmissionPermission(
          client,
          input.organizationId,
          input.actorUserId,
          "submissions:view",
          "You cannot view internal submissions."
        )
      )
      const counts = await Promise.all(
        input.statuses.map(async (status: SubmissionStatus) => {
          const selected = client
            .from("submissions")
            .select("id", { count: "exact", head: true })
          const { count, error } = await filterVisibleSubmissions(
            input.updatedSince ? selected.gte("updated_at", input.updatedSince) : selected,
            createSubmissionListFilters({ ...input, statuses: [status] }, role)
          )

          if (error) {
            throw createSubmissionDatabaseError(error, "Unable to count internal submissions.")
          }

          return [status, count ?? 0] as const
        })
      )

      return Object.fromEntries(counts)
    }
  )
}

async function countVisibleSubmissions(
  client: SubmissionServiceClient,
  filters: SubmissionListFilters
): Promise<number> {
  const { count, error } = await filterVisibleSubmissions(
    client.from("submissions").select("id", { count: "exact", head: true }),
    filters
  )

  if (error) {
    throw createSubmissionDatabaseError(
      error,
      "Unable to load internal submissions."
    )
  }

  return count ?? 0
}

/**
 * Loads one visible submission and its file allocations.
 *
 * @param input - Actor, tenant, and submission identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns Submission detail with role-scoped files, comments, and activity.
 * @throws SubmissionServiceError when access is denied or the row is absent.
 */
export async function getInternalSubmission(
  input: GetInternalSubmissionInput,
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionDetail> {
  return runSubmissionOperation(
    "get_internal_submission",
    input,
    async (): Promise<SubmissionDetail> => {
      const client = getSubmissionClient(deps)
      const { role, submission } = await loadVisibleSubmission(client, input)
      const [files, reviewData] = await Promise.all([
        listSubmissionFiles(
          client,
          input.organizationId,
          input.submissionId,
          role === "external_reviewer"
            ? ["available"]
            : ["upload_pending", "available"]
        ),
        listSubmissionReviewData(
          client,
          input.organizationId,
          input.submissionId
        ),
      ])

      return { submission, files, ...reviewData }
    }
  )
}

/**
 * Loads what the list's hover preview draws for one visible submission: its
 * title, the template snapshot it was written against, and its answers.
 * Files, comments, and activity stay on the submission's own page.
 *
 * @param input - Actor, tenant, and submission identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns The submission's title, snapshot, and answers.
 * @throws SubmissionServiceError when access is denied or the row is absent.
 */
export async function getInternalSubmissionPreview(
  input: GetInternalSubmissionInput,
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionPreview> {
  return runSubmissionOperation(
    "get_internal_submission_preview",
    input,
    async (): Promise<SubmissionPreview> => {
      const { submission } = await loadVisibleSubmission(
        getSubmissionClient(deps),
        input
      )

      return {
        answers: submission.values,
        content: submission.templateSnapshot,
        title: submission.title,
      }
    }
  )
}

// The detail page and the preview must never disagree about who may see a
// submission, so both come through this one check.
async function loadVisibleSubmission(
  client: SubmissionServiceClient,
  input: GetInternalSubmissionInput
): Promise<{
  role: ReturnType<typeof getOrganizationRoleFromSubject>
  submission: Submission
}> {
  const permissionSubject = await requireSubmissionPermission(
    client,
    input.organizationId,
    input.actorUserId,
    "submissions:view",
    "You cannot view internal submissions."
  )
  const role = getOrganizationRoleFromSubject(permissionSubject)
  const submission = await getSubmissionById(
    client,
    input.organizationId,
    input.submissionId
  )
  assertSubmissionVisible(role, submission, input.actorUserId)

  return { role, submission }
}
