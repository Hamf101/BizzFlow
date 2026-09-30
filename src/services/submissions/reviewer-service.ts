import { isOrganizationRole, type OrganizationRole } from "@/lib/permissions"
import { loadActiveMembership } from "@/services/organizations/active-membership"
import type {
  DismissSubmissionChangesRequestInput,
  SetInternalSubmissionReviewersInput,
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  createSubmissionDatabaseError,
  createSubmissionMutationError,
  getSubmissionClient,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import { parseSubmissionRow, type Submission } from "@/types/submission"
import { parseSubmissionReviewerRow, type SubmissionReviewer } from "@/types/submission-review"

const REVIEWER_COLUMNS = "user_id,assigned_by,assigned_at,decision,note,decided_at"
const MAX_REVIEWERS = 20
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

// Who outranks whom when it comes to seeing the other reviewers.
const RANK: Record<OrganizationRole, number> = { external_reviewer: 0, manager: 2, owner_admin: 3, staff: 1 }

/**
 * Names who reviews a submission and how many of them must approve, which
 * starts the review when it has not started. The first named leads.
 *
 * @param input - Actor, submission, revision, the reviewers and the approvals needed.
 * @param deps - Optional trusted database dependency.
 * @returns The submission with its next revision.
 * @throws SubmissionServiceError when access, the choice, or persistence fails.
 */
export async function setInternalSubmissionReviewers(
  input: SetInternalSubmissionReviewersInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "set_submission_reviewers",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, submissionId: input.submissionId },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:assign",
        "You cannot assign internal submissions."
      )

      const reviewerIds = input.reviewerIds.map((id) => id.trim().toLowerCase())

      if (
        reviewerIds.length < 1 ||
        reviewerIds.length > MAX_REVIEWERS ||
        new Set(reviewerIds).size !== reviewerIds.length ||
        !reviewerIds.every((id) => UUID.test(id))
      ) {
        throw new SubmissionServiceError(`Choose between 1 and ${MAX_REVIEWERS} different reviewers.`, 400)
      }

      const needed = input.requiredApprovals

      if (needed !== null && (!Number.isInteger(needed) || needed < 1 || needed > reviewerIds.length)) {
        throw new SubmissionServiceError("The approvals needed must be between 1 and the number of reviewers.", 400)
      }

      const { data, error } = await client.rpc("set_submission_reviewers", {
        target_actor_user_id: input.actorUserId,
        target_expected_revision: input.expectedRevision,
        target_org_id: input.organizationId,
        target_required_approvals: needed,
        target_reviewer_ids: reviewerIds,
        target_submission_id: input.submissionId,
      })

      if (error || !data) {
        throw createSubmissionMutationError(error, "Unable to set the reviewers.")
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * Sets one reviewer's change request aside, with a note, so the submission
 * goes back into review; the person who assigned the reviewers may also
 * approve in the same step. The database holds the rule that only they may.
 *
 * @param input - Actor, submission, revision, the reviewer, the note and the choice.
 * @param deps - Optional trusted database dependency.
 * @returns The submission with its next revision.
 * @throws SubmissionServiceError when access, the note, or persistence fails.
 */
export async function dismissSubmissionChangesRequest(
  input: DismissSubmissionChangesRequestInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "dismiss_submission_changes_request",
    { actorUserId: input.actorUserId, organizationId: input.organizationId, submissionId: input.submissionId },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:review",
        "You cannot review internal submissions."
      )

      const comment = input.comment.trim()

      if (comment.length < 1 || comment.length > 2_000) {
        throw new SubmissionServiceError("Write a note of up to 2,000 characters to set a change request aside.", 400)
      }

      const { data, error } = await client.rpc("dismiss_submission_changes_request", {
        target_actor_user_id: input.actorUserId,
        target_also_approve: input.alsoApprove,
        target_comment: comment,
        target_expected_revision: input.expectedRevision,
        target_org_id: input.organizationId,
        target_reviewer_user_id: input.reviewerUserId,
        target_submission_id: input.submissionId,
      })

      if (error || !data) {
        throw createSubmissionMutationError(error, "Unable to set the change request aside.")
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * The reviewers one person may see. Someone of the same rank as whoever
 * assigned the reviewers, or above, sees them all; anyone below sees only
 * themselves.
 *
 * @param client - Trusted Supabase client.
 * @param submission - The submission, already known to be visible to the viewer.
 * @param viewer - Who is looking, and their role.
 * @returns The reviewers in the order they were added.
 * @throws SubmissionServiceError when the read fails.
 */
export async function listSubmissionReviewers(
  client: SubmissionServiceClient,
  submission: Submission,
  viewer: { role: OrganizationRole; userId: string }
): Promise<SubmissionReviewer[]> {
  const { data, error } = await client
    .from("submission_reviewers")
    .select(REVIEWER_COLUMNS)
    .eq("org_id", submission.organizationId)
    .eq("submission_id", submission.id)
    .order("assigned_at", { ascending: true })
    .order("user_id", { ascending: true })

  if (error || !data) {
    throw createSubmissionDatabaseError(error, "Unable to load the reviewers.")
  }

  const reviewers = data.map(parseSubmissionReviewerRow)
  const seesAll = RANK[viewer.role] >= RANK[await roleOf(client, submission, submission.assignedBy)]

  return seesAll ? reviewers : reviewers.filter((reviewer) => reviewer.userId === viewer.userId)
}

/**
 * Whether the viewer is the person who assigned the reviewers, and so the one
 * who may set a change request aside.
 *
 * @param submission - The submission.
 * @param viewer - Who is looking.
 * @returns True for the assigner while they can still review.
 */
export function isReviewRequester(submission: Submission, viewer: { role: OrganizationRole; userId: string }): boolean {
  return submission.assignedBy === viewer.userId && (viewer.role === "owner_admin" || viewer.role === "manager")
}

// Someone who has left ranks lowest, so their reviewers are open to all.
async function roleOf(client: SubmissionServiceClient, submission: Submission, userId: string | null): Promise<OrganizationRole> {
  if (!userId) return "external_reviewer"

  const { data } = await loadActiveMembership(client, submission.organizationId, userId)
  const role = (data as { role?: string } | null)?.role

  return role && isOrganizationRole(role) ? role : "external_reviewer"
}
