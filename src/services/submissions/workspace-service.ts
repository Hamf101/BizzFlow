import { getOrganizationRoleFromSubject } from "@/lib/permissions"
import { readCountedPage } from "@/services/postgrest-paging"
import type {
  GetInternalSubmissionInput,
  ListInternalSubmissionsInput,
  ListSubmissionPageInput,
  SubmissionDetail,
  SubmissionPage,
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import {
  createSubmissionListFilters,
  filterVisibleSubmissions,
  normalizeSubmissionPage,
  normalizeSubmissionPageSize,
  normalizeSubmissionSort,
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
 * Lists submissions visible to one active internal organization member.
 *
 * Owners and managers receive every organization submission; staff receive only
 * submissions they created; external reviewers receive assigned non-drafts.
 *
 * @param input - Actor and tenant identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns Visible submissions ordered by most recently updated.
 * @throws SubmissionServiceError when access or persistence fails.
 */
export async function listInternalSubmissions(
  input: ListInternalSubmissionsInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission[]> {
  return runSubmissionOperation(
    "list_internal_submissions",
    input,
    async (): Promise<Submission[]> => {
      const client = getSubmissionClient(deps)
      const permissionSubject = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot view internal submissions."
      )
      const query = filterVisibleSubmissions(
        client.from("submissions").select(SUBMISSION_COLUMNS),
        createSubmissionListFilters(
          input,
          getOrganizationRoleFromSubject(permissionSubject)
        )
      )
      const { data, error } = await query.order("updated_at", {
        ascending: false,
      })

      if (error || !data) {
        throw createSubmissionDatabaseError(
          error,
          "Unable to load internal submissions."
        )
      }

      return data.map(parseSubmissionRow)
    }
  )
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
      const page = normalizeSubmissionPage(input.page)
      const pageSize = normalizeSubmissionPageSize(input.pageSize)
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
