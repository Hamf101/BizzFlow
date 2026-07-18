import { z } from "zod"

import {
  templateContentSchema,
  type TemplateContent,
} from "@/types/template"

const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_FILENAME_PATTERN = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })
const actorIdSchema = uuidSchema.nullable()
const answerValuesSchema = z.record(
  z.string(),
  z.union([z.string(), z.boolean()])
)

const submissionRowShape = {
  id: uuidSchema,
  org_id: uuidSchema,
  title: z.string().trim().min(1).max(180),
  template_id: uuidSchema,
  template_revision: z.number().int().positive(),
  template_snapshot: templateContentSchema,
  values: answerValuesSchema,
  revision: z.number().int().positive(),
  created_by: actorIdSchema,
  updated_by: actorIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
} as const

const draftSubmissionRowSchema = z.object({
  ...submissionRowShape,
  status: z.literal("draft"),
  submitted_by: z.null(),
  submitted_at: z.null(),
})

const submittedSubmissionRowSchema = z.object({
  ...submissionRowShape,
  status: z.literal("submitted"),
  submitted_by: actorIdSchema,
  submitted_at: timestampSchema,
})

const submissionRowSchema = z.discriminatedUnion("status", [
  draftSubmissionRowSchema,
  submittedSubmissionRowSchema,
])

const submissionFileRowShape = {
  id: uuidSchema,
  org_id: uuidSchema,
  submission_id: uuidSchema,
  field_key: z.string().regex(FIELD_KEY_PATTERN),
  storage_key: z.string().min(1).max(1_024),
  original_filename: z.string().trim().min(1).max(240),
  safe_filename: z.string().max(180).regex(SAFE_FILENAME_PATTERN),
  content_type: z.string().trim().min(1).max(255),
  byte_size: z.number().int().positive(),
  expected_checksum_sha256: z.string().regex(SHA256_PATTERN).nullable(),
  uploaded_by: actorIdSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
} as const

const pendingSubmissionFileRowSchema = z.object({
  ...submissionFileRowShape,
  status: z.literal("upload_pending"),
  checksum_sha256: z.null(),
  available_at: z.null(),
})

const availableSubmissionFileRowSchema = z.object({
  ...submissionFileRowShape,
  status: z.literal("available"),
  checksum_sha256: z.string().regex(SHA256_PATTERN).nullable(),
  available_at: timestampSchema,
})

const submissionFileRowSchema = z.discriminatedUnion("status", [
  pendingSubmissionFileRowSchema,
  availableSubmissionFileRowSchema,
])

/** Stable machine-readable reason for a submission domain rejection. */
export type SubmissionDomainErrorCode =
  | "incomplete_submission"
  | "invalid_submission_answers"
  | "invalid_submission_file_row"
  | "invalid_submission_row"
  | "invalid_submission_snapshot"

/** Error raised when submission data violates the domain contract. */
export class SubmissionDomainError extends Error {
  readonly code: SubmissionDomainErrorCode
  readonly statusCode: number

  /**
   * Creates an HTTP-translatable submission domain error.
   *
   * @param message - User-safe description of the rejected data.
   * @param code - Stable reason callers can use without parsing the message.
   * @param statusCode - HTTP-style status code for the calling boundary.
   */
  constructor(
    message: string,
    code: SubmissionDomainErrorCode,
    statusCode: number
  ) {
    super(message)
    this.name = "SubmissionDomainError"
    this.code = code
    this.statusCode = statusCode
  }
}

/** Lifecycle states implemented by the internal-submissions MVP. */
export type SubmissionStatus = "draft" | "submitted"

/** Storage-verification states for a single submission file. */
export type SubmissionFileStatus = "upload_pending" | "available"

/** Canonical scalar value persisted for one non-file template answer. */
export type SubmissionAnswerValue = string | boolean

/** Normalized answers keyed by immutable template field key. */
export type SubmissionAnswers = Record<string, SubmissionAnswerValue>

/** Fields shared by draft and submitted internal submissions. */
export type SubmissionBase = {
  id: string
  organizationId: string
  title: string
  templateId: string
  templateRevision: number
  templateSnapshot: TemplateContent
  values: SubmissionAnswers
  revision: number
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** Editable internal submission that has not been submitted. */
export type DraftSubmission = SubmissionBase & {
  status: "draft"
  submittedBy: null
  submittedAt: null
}

/** Immutable internal submission ready for a later review workflow. */
export type SubmittedSubmission = SubmissionBase & {
  status: "submitted"
  submittedBy: string | null
  submittedAt: string
}

/** Internal submission in one of the Sprint 7 lifecycle states. */
export type Submission = DraftSubmission | SubmittedSubmission

/** Fields shared by pending and verified single-file upload records. */
export type SubmissionFileBase = {
  id: string
  organizationId: string
  submissionId: string
  fieldKey: string
  storageKey: string
  originalFilename: string
  safeFilename: string
  contentType: string
  byteSize: number
  expectedChecksumSha256: string | null
  uploadedBy: string | null
  createdAt: string
  updatedAt: string
}

/** Allocated submission file whose object has not been verified yet. */
export type PendingSubmissionFile = SubmissionFileBase & {
  status: "upload_pending"
  checksumSha256: null
  availableAt: null
}

/** Submission file whose private object has been verified as available. */
export type AvailableSubmissionFile = SubmissionFileBase & {
  status: "available"
  checksumSha256: string | null
  availableAt: string
}

/** Single-file metadata associated with one template file field. */
export type SubmissionFile = PendingSubmissionFile | AvailableSubmissionFile

/**
 * Parses an unknown database or RPC row into a typed internal submission.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case submission data with a validated snapshot.
 * @throws SubmissionDomainError when the row violates the persistence contract.
 */
export function parseSubmissionRow(value: unknown): Submission {
  const result = submissionRowSchema.safeParse(value)

  if (!result.success) {
    throw new SubmissionDomainError(
      "Database returned an invalid submission record.",
      "invalid_submission_row",
      500
    )
  }

  const row = result.data
  const submissionBase: SubmissionBase = {
    id: row.id,
    organizationId: row.org_id,
    title: row.title,
    templateId: row.template_id,
    templateRevision: row.template_revision,
    templateSnapshot: row.template_snapshot,
    values: row.values,
    revision: row.revision,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  return row.status === "draft"
    ? {
        ...submissionBase,
        status: "draft",
        submittedBy: null,
        submittedAt: null,
      }
    : {
        ...submissionBase,
        status: "submitted",
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
      }
}

/**
 * Parses an unknown database or RPC row into typed single-file metadata.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case pending or available file metadata.
 * @throws SubmissionDomainError when the row violates the persistence contract.
 */
export function parseSubmissionFileRow(value: unknown): SubmissionFile {
  const result = submissionFileRowSchema.safeParse(value)

  if (!result.success) {
    throw new SubmissionDomainError(
      "Database returned an invalid submission file record.",
      "invalid_submission_file_row",
      500
    )
  }

  const row = result.data
  const fileBase: SubmissionFileBase = {
    id: row.id,
    organizationId: row.org_id,
    submissionId: row.submission_id,
    fieldKey: row.field_key,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    safeFilename: row.safe_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    expectedChecksumSha256: row.expected_checksum_sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  return row.status === "upload_pending"
    ? {
        ...fileBase,
        status: "upload_pending",
        checksumSha256: row.checksum_sha256,
        availableAt: row.available_at,
      }
    : {
        ...fileBase,
        status: "available",
        checksumSha256: row.checksum_sha256,
        availableAt: row.available_at,
      }
}
