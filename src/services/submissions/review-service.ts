import type {
  CreateInternalSubmissionCommentInput,
  SubmissionServiceClient,
  SubmissionServiceDeps,
  TransitionInternalSubmissionInput,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  assertSubmissionVisible,
  createSubmissionDatabaseError,
  createSubmissionId,
  createSubmissionMutationError,
  getSubmissionById,
  getSubmissionClient,
  requireSubmissionPermission,
  runSubmissionOperation,
} from "@/services/submissions/shared"
import { getOrganizationRoleFromSubject, type OrganizationRole } from "@/lib/permissions"
import { readReviewers } from "@/services/submissions/reviewer-service"
import {
  parseSubmissionRow,
  type Submission,
} from "@/types/submission"
import {
  parseSubmissionActivityEventRows,
  parseSubmissionCommentRow,
  SUBMISSION_REVIEW_TRANSITIONS,
  type SubmissionComment,
  type SubmissionReviewData,
  type SubmissionReviewTransition,
} from "@/types/submission-review"

/** Columns required by the canonical submission-comment parser. */
export const SUBMISSION_COMMENT_COLUMNS =
  "id,org_id,submission_id,body,created_by,created_at"

/** Columns required by the canonical submission-activity parser. */
export const SUBMISSION_ACTIVITY_COLUMNS =
  "id,org_id,submission_id,actor_user_id,event_type,from_status,to_status,assignee_user_id,comment_id,submission_revision,created_at"

/**
 * Applies one binding review decision through an atomic transition RPC.
 *
 * @param input - Actor, tenant, expected revision, target status, and note.
 * @param deps - Optional trusted database dependency.
 * @returns Updated submission with its next revision.
 * @throws SubmissionServiceError when access, validation, or persistence fails.
 */
export async function transitionInternalSubmission(
  input: TransitionInternalSubmissionInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "transition_internal_submission",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      expectedRevision: input.expectedRevision,
      targetStatus: input.targetStatus,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      const targetStatus = normalizeReviewTransition(input.targetStatus)
      // Approving or asking for changes is for whoever was named a reviewer,
      // whatever their role; the database checks that they were. Rejecting and
      // completing stay with those who may review.
      const decidesAsReviewer = targetStatus === "approved" || targetStatus === "needs_changes"

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        decidesAsReviewer ? "submissions:view" : "submissions:review",
        "You cannot review internal submissions."
      )
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
      const comment = normalizeReviewComment(input.comment)

      if (
        (targetStatus === "needs_changes" || targetStatus === "rejected") &&
        comment === null
      ) {
        throw new SubmissionServiceError(
          "Review comment is required when requesting changes or rejecting a submission.",
          400
        )
      }

      const { data, error } = await client.rpc(
        "transition_internal_submission",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_expected_revision: expectedRevision,
          target_transition: targetStatus,
          target_comment: comment,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to update submission review."
        )
      }

      return parseSubmissionRow(data)
    }
  )
}

/**
 * Adds an immutable general comment to one visible non-draft submission.
 *
 * @param input - Actor, tenant, submission, and untrusted comment body.
 * @param deps - Optional trusted database and identifier dependencies.
 * @returns Created immutable comment.
 * @throws SubmissionServiceError when visibility, validation, or persistence fails.
 */
export async function createInternalSubmissionComment(
  input: CreateInternalSubmissionCommentInput,
  deps: SubmissionServiceDeps = {}
): Promise<SubmissionComment> {
  return runSubmissionOperation(
    "create_internal_submission_comment",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
    },
    async (): Promise<SubmissionComment> => {
      const client = getSubmissionClient(deps)
      const permissionSubject = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submission_comments:create",
        "You cannot comment on internal submissions."
      )
      const role = getOrganizationRoleFromSubject(permissionSubject)
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      await assertSubmissionVisible(client, role, submission, input.actorUserId)

      if (submission.status === "draft") {
        throw new SubmissionServiceError(
          "Submission comments are available after submission.",
          409
        )
      }

      const body = normalizeRequiredReviewComment(input.body)
      const { data, error } = await client.rpc(
        "create_internal_submission_comment",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_comment_id: createSubmissionId(deps),
          target_body: body,
          target_actor_user_id: input.actorUserId,
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to add submission comment."
        )
      }

      return parseSubmissionCommentRow(data)
    }
  )
}

// Events that name a reviewer or someone it was shared with.
const NAMES_A_REVIEWER = new Set<string>([
  "assigned",
  "changes_dismissed",
  "reviewer_removed",
  "shared",
  "unshared",
  "suggestion_accepted",
  "suggestion_declined",
])

/**
 * Loads immutable comments and activity for an already-authorized submission,
 * leaving out what names a reviewer the viewer may not see (the same rule as
 * the reviewer panel) and the notes those events carry.
 *
 * @param client - Trusted Supabase client.
 * @param submission - The submission, already known to be visible to the viewer.
 * @param viewer - Who is looking, and their role.
 * @returns Review comments and timeline events in chronological order.
 * @throws SubmissionServiceError when either query fails or rows are invalid.
 */
export async function listSubmissionReviewData(
  client: SubmissionServiceClient,
  submission: Submission,
  viewer: { role: OrganizationRole; userId: string }
): Promise<SubmissionReviewData> {
  const [commentsResult, activityResult, reviewers] = await Promise.all([
    client
      .from("submission_comments")
      .select(SUBMISSION_COMMENT_COLUMNS)
      .eq("org_id", submission.organizationId)
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: true }),
    client
      .from("submission_activity_events")
      .select(SUBMISSION_ACTIVITY_COLUMNS)
      .eq("org_id", submission.organizationId)
      .eq("submission_id", submission.id)
      .order("created_at", { ascending: true }),
    readReviewers(client, submission, viewer),
  ])

  if (commentsResult.error || !commentsResult.data) {
    throw createSubmissionDatabaseError(
      commentsResult.error,
      "Unable to load submission comments."
    )
  }

  if (activityResult.error || !activityResult.data) {
    throw createSubmissionDatabaseError(
      activityResult.error,
      "Unable to load submission activity."
    )
  }

  const seen = new Set([viewer.userId, ...reviewers.visible.map((reviewer) => reviewer.userId)])
  const activity = parseSubmissionActivityEventRows(activityResult.data)
  const hidden = reviewers.seesAll
    ? []
    : activity.filter(
        (event) =>
          NAMES_A_REVIEWER.has(event.eventType) &&
          event.assigneeUserId !== null &&
          !seen.has(event.assigneeUserId) &&
          event.actorUserId !== viewer.userId
      )
  const hiddenNotes = new Set(hidden.map((event) => event.commentId))

  return {
    comments: commentsResult.data.map(parseSubmissionCommentRow).filter((comment) => !hiddenNotes.has(comment.id)),
    activity: activity.filter((event) => !hidden.includes(event)),
  }
}

function normalizeExpectedRevision(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new SubmissionServiceError(
      "Submission revision must be a positive integer.",
      400
    )
  }

  return value
}

function normalizeReviewTransition(
  value: unknown
): SubmissionReviewTransition {
  if (
    typeof value !== "string" ||
    !SUBMISSION_REVIEW_TRANSITIONS.includes(
      value as SubmissionReviewTransition
    )
  ) {
    throw new SubmissionServiceError(
      "Submission transition is not supported.",
      400
    )
  }

  return value as SubmissionReviewTransition
}

function normalizeReviewComment(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== "string") {
    throw new SubmissionServiceError(
      "Review comment must be text.",
      400
    )
  }

  const normalizedValue = value.trim()

  if (normalizedValue.length === 0) {
    return null
  }

  if (normalizedValue.length > 2_000) {
    throw new SubmissionServiceError(
      "Review comment must be 2,000 characters or fewer.",
      400
    )
  }

  return normalizedValue
}

function normalizeRequiredReviewComment(value: unknown): string {
  const normalizedValue = normalizeReviewComment(value)

  if (normalizedValue === null) {
    throw new SubmissionServiceError(
      "Submission comment cannot be empty.",
      400
    )
  }

  return normalizedValue
}
