import { getOrganizationRoleFromSubject, isOrganizationRole, type OrganizationRole } from "@/lib/permissions"
import { loadActiveMembership } from "@/services/organizations/active-membership"
import type {
  DismissSubmissionChangesRequestInput,
  SetInternalSubmissionReviewersInput,
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import type { SubmissionListFilters } from "@/services/submissions/list-filters"
import {
  createSubmissionDatabaseError,
  createSubmissionMutationError,
  getSubmissionById,
  getSubmissionClient,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import { parseSubmissionRow, type Submission } from "@/types/submission"
import { parseSubmissionReviewerRow, type SubmissionReviewer, type SubmissionReviewTally } from "@/types/submission-review"

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

      const subject = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:assign",
        "You cannot assign internal submissions."
      )

      // Reviewers someone more senior chose are not for a more junior person to change.
      const current = await getSubmissionById(client, input.organizationId, input.submissionId)

      if (
        current.assignedBy &&
        current.assignedBy !== input.actorUserId &&
        RANK[getOrganizationRoleFromSubject(subject)] < RANK[await roleOf(client, current, current.assignedBy)]
      ) {
        throw new SubmissionServiceError("The reviewers were chosen by someone more senior, so only they or an owner can change them.", 403)
      }

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
 * The reviewers one person may see, and how the whole panel stands. Someone of
 * the same rank as whoever assigned the reviewers, or above, sees them all;
 * anyone below sees only themselves. The tally counts everyone either way.
 *
 * @param client - Trusted Supabase client.
 * @param submission - The submission, already known to be visible to the viewer.
 * @param viewer - Who is looking, and their role.
 * @returns The visible reviewers in the order they were added, and the tally.
 * @throws SubmissionServiceError when the read fails.
 */
export async function listSubmissionReviewers(
  client: SubmissionServiceClient,
  submission: Submission,
  viewer: { role: OrganizationRole; userId: string }
): Promise<{ reviewers: SubmissionReviewer[]; tally: SubmissionReviewTally }> {
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

  const all = data.map(parseSubmissionReviewerRow)
  const seesAll = RANK[viewer.role] >= RANK[await roleOf(client, submission, submission.assignedBy)]
  const count = (decision: SubmissionReviewer["decision"]): number => all.filter((reviewer) => reviewer.decision === decision).length

  return {
    reviewers: seesAll ? all : all.filter((reviewer) => reviewer.userId === viewer.userId),
    tally: { approved: count("approved"), changesRequested: count("changes_requested"), total: all.length },
  }
}

/**
 * Adds to an external reviewer's filters the submissions they review. Everyone
 * else's filters come back as they were.
 *
 * @param client - Trusted Supabase client.
 * @param filters - Validated actor scope and view filters.
 * @returns Filters that can be applied to a query.
 * @throws SubmissionServiceError when the read fails.
 */
export async function withReviewedIds(client: SubmissionServiceClient, filters: SubmissionListFilters): Promise<SubmissionListFilters> {
  if (filters.role !== "external_reviewer") {
    return filters
  }

  const { data, error } = await client
    .from("submission_reviewers")
    .select("submission_id")
    .eq("org_id", filters.organizationId)
    .eq("user_id", filters.actorUserId)

  if (error || !data) {
    throw createSubmissionDatabaseError(error, "Unable to load the submissions you review.")
  }

  // ponytail: one read is capped at PostgREST's row limit; an external reviewer with that many reviews would need paging.
  return { ...filters, reviewedIds: data.map((row) => String(row.submission_id)) }
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
