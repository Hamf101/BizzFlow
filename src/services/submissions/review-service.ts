import type {
  AssignInternalSubmissionInput,
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
import {
  parseSubmissionRow,
  type Submission,
} from "@/types/submission"
import {
  parseSubmissionActivityEventRow,
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
 * Assigns or reassigns one submission through the atomic review RPC.
 *
 * Assigning a submitted row starts review; reassignment in an active workflow
 * retains the current state. The database validates tenant membership and the
 * assignee's eligible role inside the transaction.
 *
 * @param input - Actor, tenant, submission revision, and target assignee.
 * @param deps - Optional trusted database dependency.
 * @returns Updated submission with its next revision.
 * @throws SubmissionServiceError when access, validation, or persistence fails.
 */
export async function assignInternalSubmission(
  input: AssignInternalSubmissionInput,
  deps: SubmissionServiceDeps = {}
): Promise<Submission> {
  return runSubmissionOperation(
    "assign_internal_submission",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      expectedRevision: input.expectedRevision,
      assignedTo: input.assignedTo,
    },
    async (): Promise<Submission> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:assign",
        "You cannot assign internal submissions."
      )
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
      const assignedTo = normalizeUuid(
        input.assignedTo,
        "Submission assignee must be a valid user id."
      )
      const { data, error } = await client.rpc("assign_internal_submission", {
        target_org_id: input.organizationId,
        target_submission_id: input.submissionId,
        target_expected_revision: expectedRevision,
        target_assignee_user_id: assignedTo,
        target_actor_user_id: input.actorUserId,
      })

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to assign internal submission."
        )
      }

      return parseSubmissionRow(data)
    }
  )
}

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

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:review",
        "You cannot review internal submissions."
      )
      const expectedRevision = normalizeExpectedRevision(input.expectedRevision)
      const targetStatus = normalizeReviewTransition(input.targetStatus)
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
      const role = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submission_comments:create",
        "You cannot comment on internal submissions."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      assertSubmissionVisible(role, submission, input.actorUserId)

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

/**
 * Loads immutable comments and activity for an already-authorized submission.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param submissionId - Submission identifier.
 * @returns Review comments and timeline events in chronological order.
 * @throws SubmissionServiceError when either query fails or rows are invalid.
 */
export async function listSubmissionReviewData(
  client: SubmissionServiceClient,
  organizationId: string,
  submissionId: string
): Promise<SubmissionReviewData> {
  const [commentsResult, activityResult] = await Promise.all([
    client
      .from("submission_comments")
      .select(SUBMISSION_COMMENT_COLUMNS)
      .eq("org_id", organizationId)
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: true }),
    client
      .from("submission_activity_events")
      .select(SUBMISSION_ACTIVITY_COLUMNS)
      .eq("org_id", organizationId)
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: true }),
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

  return {
    comments: commentsResult.data.map(parseSubmissionCommentRow),
    activity: activityResult.data.map(parseSubmissionActivityEventRow),
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

function normalizeUuid(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new SubmissionServiceError(message, 400)
  }

  const normalizedValue = value.trim().toLowerCase()

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      normalizedValue
    )
  ) {
    throw new SubmissionServiceError(message, 400)
  }

  return normalizedValue
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
