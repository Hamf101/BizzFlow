import { randomUUID } from "node:crypto"

import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { SubmissionStorageServiceError } from "@/services/submission-storage-service"
import type {
  SubmissionLogValue,
  SubmissionServiceClient,
  SubmissionServiceDeps,
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  normalizeSubmissionDraftAnswers as defaultNormalizeSubmissionDraftAnswers,
} from "@/services/submissions/validation"
import {
  parseSubmissionFileRow,
  parseSubmissionRow,
  SubmissionDomainError,
  type Submission,
  type SubmissionAnswers,
  type SubmissionFile,
  type SubmissionFileStatus,
} from "@/types/submission"
import { SubmissionReviewDomainError } from "@/types/submission-review"

/** Columns required by the canonical submission row parser. */
export const SUBMISSION_COLUMNS =
  "id,org_id,title,template_id,template_revision,template_snapshot,values,status,revision,created_by,updated_by,submitted_by,assigned_to,assigned_by,created_at,updated_at,submitted_at,assigned_at"

/** Columns required by the canonical submission-file row parser. */
export const SUBMISSION_FILE_COLUMNS =
  "id,org_id,submission_id,field_key,status,storage_key,original_filename,safe_filename,content_type,byte_size,expected_checksum_sha256,checksum_sha256,uploaded_by,created_at,updated_at,available_at"

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

type MembershipRow = {
  role: string
}

/**
 * Runs a submission operation with contextual timing and safe error translation.
 *
 * @param operationName - Stable operation identifier for logs.
 * @param identifiers - Tenant, actor, and target identifiers.
 * @param operation - Asynchronous service operation.
 * @returns The operation result.
 * @throws SubmissionServiceError for every expected or unexpected failure.
 */
export async function runSubmissionOperation<T>(
  operationName: string,
  identifiers: Record<string, SubmissionLogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("submission_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    const serviceError = toSubmissionServiceError(error)
    const log = serviceError.statusCode >= 500 ? console.error : console.warn
    log("submission_service_rejected", {
      operationName,
      statusCode: serviceError.statusCode,
      durationMs: Date.now() - startedAt,
      actorUserId: identifiers.actorUserId,
      organizationId: identifiers.organizationId,
      submissionId: identifiers.submissionId,
    })
    throw serviceError
  }
}

/**
 * Resolves the injected trusted Supabase client or creates the production client.
 *
 * @param deps - Optional submission service dependencies.
 * @returns Trusted database client.
 */
export function getSubmissionClient(
  deps: SubmissionServiceDeps
): SubmissionServiceClient {
  return deps.client ?? createAdminClient()
}

/**
 * Creates a UUID using an injected generator when provided.
 *
 * @param deps - Optional submission service dependencies.
 * @returns New submission, file, or comment identifier.
 */
export function createSubmissionId(deps: SubmissionServiceDeps): string {
  return deps.createId?.() ?? randomUUID()
}

/**
 * Requires an active organization membership with the requested permission.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param actorUserId - Requesting user identifier.
 * @param action - Required permission action.
 * @param rejectionMessage - User-safe access rejection.
 * @returns Validated active organization role.
 * @throws SubmissionServiceError when membership is absent or invalid.
 */
export async function requireSubmissionPermission(
  client: SubmissionServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<OrganizationRole> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", actorUserId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createSubmissionDatabaseError(
      error,
      "Unable to load organization membership."
    )
  }

  const role = (data as MembershipRow | null)?.role

  if (
    !role ||
    !isOrganizationRole(role) ||
    !canPerformOrganizationAction(role, action)
  ) {
    throw new SubmissionServiceError(rejectionMessage, 403)
  }

  return role
}

/**
 * Loads a tenant-scoped submission without applying actor visibility.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param submissionId - Submission identifier.
 * @returns Parsed internal submission.
 * @throws SubmissionServiceError when the row is absent or invalid.
 */
export async function getSubmissionById(
  client: SubmissionServiceClient,
  organizationId: string,
  submissionId: string
): Promise<Submission> {
  const { data, error } = await client
    .from("submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("org_id", organizationId)
    .eq("id", submissionId)
    .maybeSingle()

  if (error) {
    throw createSubmissionDatabaseError(error, "Unable to load submission.")
  }

  if (!data) {
    throw new SubmissionServiceError("Submission was not found.", 404)
  }

  return parseSubmissionRow(data)
}

/**
 * Loads all file allocations for one tenant-scoped submission.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param submissionId - Submission identifier.
 * @param statuses - Active file states visible to the caller.
 * @returns File allocations ordered by creation time.
 * @throws SubmissionServiceError when the query fails.
 */
export async function listSubmissionFiles(
  client: SubmissionServiceClient,
  organizationId: string,
  submissionId: string,
  statuses: readonly SubmissionFileStatus[] = [
    "upload_pending",
    "available",
  ]
): Promise<SubmissionFile[]> {
  const { data, error } = await client
    .from("submission_files")
    .select(SUBMISSION_FILE_COLUMNS)
    .eq("org_id", organizationId)
    .eq("submission_id", submissionId)
    .in("status", Array.from(statuses))
    .order("created_at", { ascending: true })

  if (error || !data) {
    throw createSubmissionDatabaseError(
      error,
      "Unable to load submission files."
    )
  }

  return data.map(parseSubmissionFileRow)
}

/**
 * Applies role-based submission visibility after a trusted admin query.
 *
 * @param role - Validated internal organization role.
 * @param submission - Tenant-scoped submission.
 * @param actorUserId - Requesting user identifier.
 * @throws SubmissionServiceError when the row is outside the actor's role scope.
 */
export function assertSubmissionVisible(
  role: OrganizationRole,
  submission: Submission,
  actorUserId: string
): void {
  if (role === "staff" && submission.createdBy !== actorUserId) {
    throw new SubmissionServiceError("Submission was not found.", 404)
  }

  if (
    role === "external_reviewer" &&
    (submission.status === "draft" || submission.assignedTo !== actorUserId)
  ) {
    throw new SubmissionServiceError("Submission was not found.", 404)
  }
}

/**
 * Requires the creator to own an editable submission at an exact revision.
 *
 * @param submission - Current persisted submission.
 * @param actorUserId - Requesting user identifier.
 * @param expectedRevision - Client revision used for optimistic concurrency.
 * @throws SubmissionServiceError for non-owners, locked rows, or stale revisions.
 */
export function assertEditableSubmissionDraft(
  submission: Submission,
  actorUserId: string,
  expectedRevision: number
): void {
  if (submission.createdBy !== actorUserId) {
    throw new SubmissionServiceError(
      "Only the submission creator may change this draft.",
      403
    )
  }

  if (
    submission.status !== "draft" &&
    submission.status !== "needs_changes"
  ) {
    throw new SubmissionServiceError(
      "This submission is not editable in its current status.",
      409
    )
  }

  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    submission.revision !== expectedRevision
  ) {
    throw new SubmissionServiceError(
      "Submission draft has changed. Reload and try again.",
      409
    )
  }
}

/**
 * Merges a form patch over persisted answers and normalizes the complete object.
 *
 * @param submission - Current immutable snapshot and persisted answers.
 * @param valuesPatch - Untrusted form patch.
 * @param deps - Optional normalization dependency.
 * @returns Full normalized answer object safe for an RPC replacement write.
 */
export async function mergeAndNormalizeSubmissionAnswers(
  submission: Submission,
  valuesPatch: unknown,
  deps: SubmissionServiceDeps
): Promise<SubmissionAnswers> {
  const normalizeAnswers =
    deps.normalizeSubmissionDraftAnswers ??
    defaultNormalizeSubmissionDraftAnswers
  const normalizedPatch = await normalizeAnswers(
    submission.templateSnapshot,
    valuesPatch
  )

  return normalizeAnswers(submission.templateSnapshot, {
    ...submission.values,
    ...normalizedPatch,
  })
}

/**
 * Converts a Supabase query failure to a safe submission service error.
 *
 * @param error - Supabase or setup error.
 * @param fallbackMessage - Safe message for unexpected database failures.
 * @returns Submission service error.
 */
export function createSubmissionDatabaseError(
  error: unknown,
  fallbackMessage: string
): SubmissionServiceError {
  const errorLike = asSupabaseError(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return new SubmissionServiceError(
      "Internal submissions are not installed. Apply the latest Supabase migrations.",
      500
    )
  }

  if (searchableMessage.includes("permission denied")) {
    return new SubmissionServiceError(
      "Internal submission database permissions are incomplete.",
      500
    )
  }

  return new SubmissionServiceError(fallbackMessage, 500)
}

/**
 * Maps a submission mutation RPC error to a useful client response.
 *
 * @param error - Supabase RPC error.
 * @param fallbackMessage - Safe fallback for unknown failures.
 * @returns Submission service error with a 400, 403, 404, 409, or 500 status.
 */
export function createSubmissionMutationError(
  error: unknown,
  fallbackMessage: string
): SubmissionServiceError {
  const errorLike = asSupabaseError(error)
  const code = errorLike?.code
  const safeMessage = getKnownMutationMessage(errorLike?.message)

  if (code === "22023") {
    return new SubmissionServiceError(safeMessage ?? fallbackMessage, 400)
  }

  if (code === "42501") {
    return new SubmissionServiceError(
      safeMessage ?? "You cannot change this submission.",
      403
    )
  }

  if (code === "P0002" || code === "PGRST116") {
    return new SubmissionServiceError(
      safeMessage ?? "Submission was not found.",
      404
    )
  }

  if (
    code === "40001" ||
    code === "P0001" ||
    code === "23505" ||
    code === "23514"
  ) {
    return new SubmissionServiceError(safeMessage ?? fallbackMessage, 409)
  }

  return createSubmissionDatabaseError(error, fallbackMessage)
}

function toSubmissionServiceError(error: unknown): SubmissionServiceError {
  if (error instanceof SubmissionServiceError) {
    return error
  }

  if (
    error instanceof SubmissionStorageServiceError ||
    error instanceof SubmissionDomainError ||
    error instanceof SubmissionReviewDomainError
  ) {
    return new SubmissionServiceError(error.message, error.statusCode)
  }

  if (error instanceof Error) {
    if (error.message.includes("Invalid admin Supabase environment")) {
      return new SubmissionServiceError(
        "Supabase server credentials are not configured.",
        500
      )
    }
  }

  return new SubmissionServiceError("Submission service failed.", 500)
}

function asSupabaseError(error: unknown): SupabaseErrorLike | null {
  return error && typeof error === "object"
    ? (error as SupabaseErrorLike)
    : null
}

function getKnownMutationMessage(message: string | undefined): string | null {
  if (!message || message.length > 500 || /[\r\n]/.test(message)) {
    return null
  }

  const safePrefixes = [
    "Active review assignee",
    "An active internal organization membership",
    "Assigned reviewer",
    "Complete submission file metadata",
    "Completed submission file metadata",
    "Files cannot be",
    "Only the submission creator",
    "Only the assigned reviewer",
    "Published submission template",
    "Required submission",
    "Review comment",
    "Submission assignee",
    "Submission assignment",
    "Submission comment",
    "Submission draft",
    "Submission field",
    "Submission file",
    "Submission identifier",
    "Submission review",
    "Submission revision",
    "Submission status",
    "Submission timestamp",
    "Submission transition",
    "Submission values",
    "Submitted submissions",
    "This submission field",
    "Uploaded object metadata",
    "Valid submission",
    "Valid draft",
    "Verified submission",
    "Wait for pending",
  ]

  return safePrefixes.some((prefix: string): boolean =>
    message.startsWith(prefix)
  )
    ? message
    : null
}
