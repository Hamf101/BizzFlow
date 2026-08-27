import { formatCsv } from "@/lib/csv"
import type {
  ListInternalSubmissionsInput,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import { runSubmissionOperation } from "@/services/submissions/shared"
import { listInternalSubmissions } from "@/services/submissions/workspace-service"
import type { Submission } from "@/types/submission"

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

/**
 * Generates an RFC-4180 CSV document from internal submissions.
 *
 * @param submissions - Submissions in the order they should appear.
 * @returns CSV text with a header row and one row per submission.
 */
export function formatSubmissionsAsCsv(
  submissions: readonly Submission[]
): string {
  return formatCsv(
    SUBMISSION_CSV_HEADERS,
    submissions.map((submission: Submission): readonly unknown[] => [
      submission.id,
      submission.title,
      submission.status,
      submission.templateId,
      submission.createdAt,
      submission.submittedAt,
      submission.updatedAt,
    ]),
    // Submission titles are free text typed by members, and this export is
    // opened in Excel. The audit log deliberately does not do this: it is an
    // evidentiary record and its exported bytes must match what was stored.
    true
  )
}

/**
 * Exports the submissions one actor may see as CSV text.
 *
 * Rows come from `listInternalSubmissions`, so the export carries the same
 * role-scoped visibility as the submissions list: staff see only submissions
 * they created and external reviewers only their assigned non-drafts. The
 * previous route-level implementation exported every organization row to any
 * holder of `submissions:view`.
 *
 * @param input - Actor and tenant identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns CSV text for the actor's visible submissions.
 * @throws SubmissionServiceError when access or persistence fails.
 */
export async function exportInternalSubmissionsCsv(
  input: ListInternalSubmissionsInput,
  deps: SubmissionServiceDeps = {}
): Promise<string> {
  return runSubmissionOperation(
    "export_internal_submissions",
    input,
    async (): Promise<string> =>
      formatSubmissionsAsCsv(await listInternalSubmissions(input, deps))
  )
}
