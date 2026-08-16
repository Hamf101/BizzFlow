import type {
  GetInternalSubmissionInput,
  ListInternalSubmissionsInput,
  SubmissionDetail,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
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
} from "@/types/submission"

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
      const role = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot view internal submissions."
      )
      let query = client
        .from("submissions")
        .select(SUBMISSION_COLUMNS)
        .eq("org_id", input.organizationId)

      if (role === "staff") {
        query = query.eq("created_by", input.actorUserId)
      } else if (role === "external_reviewer") {
        query = query
          .eq("assigned_to", input.actorUserId)
          .in("status", [
            "submitted",
            "in_review",
            "needs_changes",
            "approved",
            "rejected",
            "completed",
          ])
      }

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
      const role = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot view internal submissions."
      )
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
