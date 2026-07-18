import { z } from "zod"

import type { SubmissionStatus } from "@/types/submission"

/** Immutable activity kinds recorded by the submission review workflow. */
export const SUBMISSION_ACTIVITY_EVENT_TYPES = [
  "submitted",
  "resubmitted",
  "assigned",
  "commented",
  "changes_requested",
  "approved",
  "rejected",
  "completed",
] as const

/** Binding state changes available to submission reviewers. */
export const SUBMISSION_REVIEW_TRANSITIONS = [
  "needs_changes",
  "approved",
  "rejected",
  "completed",
] as const

/** Immutable submission activity event kind. */
export type SubmissionActivityEventType =
  (typeof SUBMISSION_ACTIVITY_EVENT_TYPES)[number]

/** State change accepted by the review transition service. */
export type SubmissionReviewTransition =
  (typeof SUBMISSION_REVIEW_TRANSITIONS)[number]

/** Database row returned for an immutable submission comment. */
export type SubmissionCommentRow = Record<string, unknown> & {
  id: string
  org_id: string
  submission_id: string
  body: string
  created_by: string | null
  created_at: string
}

/** Tenant-scoped immutable comment attached to a submission. */
export type SubmissionComment = {
  id: string
  organizationId: string
  submissionId: string
  body: string
  createdBy: string | null
  createdAt: string
}

/** Database row returned for an immutable submission activity event. */
export type SubmissionActivityEventRow = Record<string, unknown> & {
  id: string
  org_id: string
  submission_id: string
  actor_user_id: string | null
  event_type: string
  from_status: string
  to_status: string
  assignee_user_id: string | null
  comment_id: string | null
  submission_revision: number
  created_at: string
}

/** Tenant-scoped event in a submission's review timeline. */
export type SubmissionActivityEvent = {
  id: string
  organizationId: string
  submissionId: string
  actorUserId: string | null
  eventType: SubmissionActivityEventType
  fromStatus: SubmissionStatus
  toStatus: SubmissionStatus
  assigneeUserId: string | null
  commentId: string | null
  submissionRevision: number
  createdAt: string
}

/** Comments and state history shown with one visible submission. */
export type SubmissionReviewData = {
  comments: SubmissionComment[]
  activity: SubmissionActivityEvent[]
}

/** Error raised when review persistence data violates its domain contract. */
export class SubmissionReviewDomainError extends Error {
  readonly statusCode = 500

  /**
   * Creates a safe review-domain parsing error.
   *
   * @param message - User-safe description of the invalid persistence data.
   */
  constructor(message: string) {
    super(message)
    this.name = "SubmissionReviewDomainError"
  }
}

const uuidSchema = z.string().uuid()
const nullableUuidSchema = uuidSchema.nullable()
const timestampSchema = z.string().datetime({ offset: true })
const submissionStatusSchema = z.enum([
  "draft",
  "submitted",
  "in_review",
  "needs_changes",
  "approved",
  "rejected",
  "completed",
])
const submissionCommentRowSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  submission_id: uuidSchema,
  body: z.string().trim().min(1).max(2_000),
  created_by: nullableUuidSchema,
  created_at: timestampSchema,
})
const submissionActivityEventRowSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  submission_id: uuidSchema,
  actor_user_id: nullableUuidSchema,
  event_type: z.enum(SUBMISSION_ACTIVITY_EVENT_TYPES),
  from_status: submissionStatusSchema,
  to_status: submissionStatusSchema,
  assignee_user_id: nullableUuidSchema,
  comment_id: nullableUuidSchema,
  submission_revision: z.number().int().positive(),
  created_at: timestampSchema,
})

/**
 * Parses an unknown database or RPC row into a submission comment.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case immutable comment.
 * @throws SubmissionReviewDomainError when the row is invalid.
 */
export function parseSubmissionCommentRow(value: unknown): SubmissionComment {
  const result = submissionCommentRowSchema.safeParse(value)

  if (!result.success) {
    throw new SubmissionReviewDomainError(
      "Database returned an invalid submission comment."
    )
  }

  return {
    id: result.data.id,
    organizationId: result.data.org_id,
    submissionId: result.data.submission_id,
    body: result.data.body,
    createdBy: result.data.created_by,
    createdAt: result.data.created_at,
  }
}

/**
 * Parses an unknown database row into a submission activity event.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case immutable activity event.
 * @throws SubmissionReviewDomainError when the row is invalid.
 */
export function parseSubmissionActivityEventRow(
  value: unknown
): SubmissionActivityEvent {
  const result = submissionActivityEventRowSchema.safeParse(value)

  if (!result.success) {
    throw new SubmissionReviewDomainError(
      "Database returned an invalid submission activity event."
    )
  }

  return {
    id: result.data.id,
    organizationId: result.data.org_id,
    submissionId: result.data.submission_id,
    actorUserId: result.data.actor_user_id,
    eventType: result.data.event_type,
    fromStatus: result.data.from_status,
    toStatus: result.data.to_status,
    assigneeUserId: result.data.assignee_user_id,
    commentId: result.data.comment_id,
    submissionRevision: result.data.submission_revision,
    createdAt: result.data.created_at,
  }
}
