import { z } from "zod"

import { formatCsv } from "@/lib/csv"
import type { ListSort } from "@/lib/list-state"
import { getOrganizationRoleFromSubject } from "@/lib/permissions"
import {
  POSTGREST_BATCH_SIZE,
  readAllInBatches,
} from "@/services/postgrest-paging"
import type {
  ExportSubmissionsInput,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  createSubmissionListFilters,
  filterVisibleSubmissions,
  normalizeSubmissionSort,
} from "@/services/submissions/list-filters"
import {
  createSubmissionDatabaseError,
  getSubmissionClient,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import type { SubmissionSortKey } from "@/types/submission"

/** Largest submissions export; a bigger one must be narrowed first. */
export const SUBMISSION_EXPORT_MAX_ROWS = 50_000

/** Export columns, in output order. */
const SUBMISSION_CSV_HEADERS = [
  "Submission ID",
  "Title",
  "Status",
  "Template ID",
  "Created At",
  "Submitted At",
  "Updated At",
] as const

const SUBMISSION_EXPORT_COLUMNS =
  "id,title,status,template_id,created_at,submitted_at,updated_at"

const submissionExportRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  template_id: z.string(),
  created_at: z.string(),
  submitted_at: z.string().nullable(),
  updated_at: z.string(),
})

type SubmissionExportRow = z.infer<typeof submissionExportRowSchema>

const EXPORT_SORT_COLUMNS: Record<
  SubmissionSortKey,
  "created_at" | "title" | "updated_at"
> = {
  created: "created_at",
  title: "title",
  updated: "updated_at",
}

/**
 * Exports every submission one actor may see in a view, as CSV text.
 *
 * Rows carry the same role-scoped visibility and view filters as the
 * submissions list: staff see only submissions they created and external
 * reviewers only their assigned non-drafts. Batches follow ids, so a row that
 * changes during the export can neither shift a batch boundary nor appear
 * twice; the view's order is applied once every row is in. An export larger
 * than the limit is refused, never truncated.
 *
 * @param input - Actor, tenant, and optional view filters and order.
 * @param deps - Optional trusted database dependency and export limit.
 * @returns CSV text for the actor's visible submissions in the view.
 * @throws SubmissionServiceError when access, validation, the limit, or a read fails.
 */
export async function exportInternalSubmissionsCsv(
  input: ExportSubmissionsInput,
  deps: SubmissionServiceDeps = {}
): Promise<string> {
  return runSubmissionOperation(
    "export_internal_submissions",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<string> => {
      const client = getSubmissionClient(deps)
      const permissionSubject = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot view internal submissions."
      )
      const sort = normalizeSubmissionSort(input.sort)
      const filters = createSubmissionListFilters(
        input,
        getOrganizationRoleFromSubject(permissionSubject)
      )
      const maxRows = deps.maxExportRows ?? SUBMISSION_EXPORT_MAX_ROWS
      const rows = await readAllInBatches(
        async (previous: SubmissionExportRow | undefined) => {
          let query = filterVisibleSubmissions(
            client.from("submissions").select(SUBMISSION_EXPORT_COLUMNS),
            filters
          )

          if (previous !== undefined) {
            query = query.gt("id", previous.id)
          }

          const { data, error } = await query
            .order("id", { ascending: true })
            .limit(POSTGREST_BATCH_SIZE)

          return {
            data: data ? submissionExportRowSchema.array().parse(data) : null,
            error,
          }
        },
        {
          fail: (error: unknown): Error =>
            createSubmissionDatabaseError(error, "Unable to export submissions."),
          maxRows,
          tooMany: (): Error =>
            new SubmissionServiceError(
              `This export has more than ${maxRows.toLocaleString("en")} submissions. Choose a status to export it in parts.`,
              413
            ),
        }
      )

      return formatSubmissionsAsCsv(sortExportRows(rows, sort))
    }
  )
}

function sortExportRows(
  rows: readonly SubmissionExportRow[],
  sort: ListSort<SubmissionSortKey>
): SubmissionExportRow[] {
  const column = EXPORT_SORT_COLUMNS[sort.key]
  const direction = sort.direction === "asc" ? 1 : -1

  return [...rows].sort(
    (left: SubmissionExportRow, right: SubmissionExportRow): number =>
      (column === "title"
        ? left.title.localeCompare(right.title)
        : compareText(left[column], right[column])) * direction ||
      compareText(left.id, right.id)
  )
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatSubmissionsAsCsv(rows: readonly SubmissionExportRow[]): string {
  return formatCsv(
    SUBMISSION_CSV_HEADERS,
    rows.map((row: SubmissionExportRow): readonly unknown[] => [
      row.id,
      row.title,
      row.status,
      row.template_id,
      row.created_at,
      row.submitted_at,
      row.updated_at,
    ]),
    // Submission titles are free text typed by members, and this export is
    // opened in Excel. The audit log deliberately does not do this: it is an
    // evidentiary record and its exported bytes must match what was stored.
    true
  )
}
