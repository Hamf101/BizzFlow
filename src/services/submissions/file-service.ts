import {
  assertSubmissionFilenameMatchesContentType,
  buildSubmissionFileObjectKey,
  createSafeSubmissionFilename as defaultCreateSafeSubmissionFilename,
  createSignedSubmissionDownloadUrl as defaultCreateSignedSubmissionDownloadUrl,
  createSignedSubmissionUploadUrl as defaultCreateSignedSubmissionUploadUrl,
  deleteSubmissionStorageObject as defaultDeleteSubmissionStorageObject,
  normalizeSubmissionOriginalFilename as defaultNormalizeSubmissionOriginalFilename,
  SUBMISSION_UPLOAD_CLEANUP_GRACE_SECONDS,
  validateSubmissionUploadRequest as defaultValidateSubmissionUploadRequest,
  verifySubmissionUpload as defaultVerifySubmissionUpload
} from "@/services/submission-storage-service"
import type {
  AllocateInternalSubmissionFileInput,
  AllocateInternalSubmissionFileResponse,
  CompleteInternalSubmissionFileInput,
  CompleteInternalSubmissionFileResponse,
  CreateInternalSubmissionFileDownloadUrlInput,
  CreateInternalSubmissionFileDownloadUrlResponse,
  SubmissionServiceDeps,
  SupersedeInternalSubmissionFileInput,
  SupersedeInternalSubmissionFileResponse
} from "@/services/submissions/contracts"
import { SubmissionServiceError } from "@/services/submissions/errors"
import {
  assertEditableSubmissionDraft,
  assertSubmissionVisible,
  createSubmissionId,
  createSubmissionMutationError,
  getSubmissionById,
  getSubmissionClient,
  listSubmissionFiles,
  requireSubmissionPermission,
  runSubmissionOperation
} from "@/services/submissions/shared"
import {
  parseSubmissionFileRow,
  type Submission,
  type SubmissionFile
} from "@/types/submission"

/**
 * Allocates or safely resumes one create-only file upload for a draft field.
 *
 * @param input - Actor, draft revision, file field, and browser file metadata.
 * @param deps - Optional trusted database, storage, and identifier dependencies.
 * @returns Persisted allocation plus a create-only signed PUT URL.
 * @throws SubmissionServiceError when ownership, metadata, or persistence fails.
 */
export async function allocateInternalSubmissionFile(
  input: AllocateInternalSubmissionFileInput,
  deps: SubmissionServiceDeps = {}
): Promise<AllocateInternalSubmissionFileResponse> {
  return runSubmissionOperation(
    "allocate_internal_submission_file",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      submissionId: input.submissionId,
      fieldKey: input.fieldKey,
      contentType: input.contentType,
      byteSize: input.byteSize
    },
    async (): Promise<AllocateInternalSubmissionFileResponse> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot upload internal submission files."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      assertEditableSubmissionDraft(
        submission,
        input.actorUserId,
        input.expectedRevision
      )
      const fieldKey = input.fieldKey.trim()
      requireSnapshotFileField(submission, fieldKey)

      const normalizeOriginalFilename =
        deps.normalizeSubmissionOriginalFilename ??
        defaultNormalizeSubmissionOriginalFilename
      const createSafeFilename =
        deps.createSafeSubmissionFilename ?? defaultCreateSafeSubmissionFilename
      const validateUpload =
        deps.validateSubmissionUploadRequest ??
        defaultValidateSubmissionUploadRequest
      const originalFilename = normalizeOriginalFilename(input.originalFilename)
      const safeFilename = createSafeFilename(originalFilename)

      validateUpload({
        contentType: input.contentType,
        byteSize: input.byteSize,
        checksumSha256: input.checksumSha256
      })
      assertSubmissionFilenameMatchesContentType(
        originalFilename,
        input.contentType
      )

      const files = await listSubmissionFiles(
        client,
        input.organizationId,
        input.submissionId
      )
      const existingFile = files.find(
        (file: SubmissionFile): boolean => file.fieldKey === fieldKey
      )
      let file: SubmissionFile

      if (existingFile) {
        assertReusablePendingAllocation(existingFile, {
          actorUserId: input.actorUserId,
          originalFilename,
          safeFilename,
          contentType: input.contentType,
          byteSize: input.byteSize,
          checksumSha256: input.checksumSha256
        })
        file = existingFile
      } else {
        const fileId = createSubmissionId(deps)
        const storageKey = buildSubmissionFileObjectKey({
          organizationId: input.organizationId,
          submissionId: input.submissionId,
          fieldKey,
          fileId,
          safeFilename
        })
        const { data, error } = await client.rpc(
          "allocate_internal_submission_file",
          {
            target_org_id: input.organizationId,
            target_submission_id: input.submissionId,
            target_expected_revision: input.expectedRevision,
            target_file_id: fileId,
            target_field_key: fieldKey,
            target_original_filename: originalFilename,
            target_safe_filename: safeFilename,
            target_content_type: input.contentType,
            target_byte_size: input.byteSize,
            target_storage_key: storageKey,
            target_expected_checksum_sha256: input.checksumSha256,
            target_actor_user_id: input.actorUserId
          }
        )

        if (error || !data) {
          throw createSubmissionMutationError(
            error,
            "Unable to allocate submission file upload."
          )
        }

        file = parseSubmissionFileRow(data)
      }

      const createSignedUploadUrl =
        deps.createSignedSubmissionUploadUrl ??
        defaultCreateSignedSubmissionUploadUrl
      const signedUrl = await createSignedUploadUrl({
        organizationId: file.organizationId,
        submissionId: file.submissionId,
        fieldKey: file.fieldKey,
        fileId: file.id,
        safeFilename: file.safeFilename,
        contentType: file.contentType,
        byteSize: file.byteSize,
        checksumSha256: input.checksumSha256
      })

      if (signedUrl.storageKey !== file.storageKey) {
        throw new SubmissionServiceError(
          "Submission file storage allocation is inconsistent.",
          500
        )
      }

      const now = deps.now?.() ?? new Date()
      const cleanupAfter = new Date(
        now.getTime() +
          (signedUrl.expiresInSeconds +
            SUBMISSION_UPLOAD_CLEANUP_GRACE_SECONDS) *
            1_000
      ).toISOString()
      const { data: recordedFileData, error: recordWindowError } =
        await client.rpc("record_internal_submission_file_upload_window", {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_file_id: file.id,
          target_cleanup_after: cleanupAfter,
          target_actor_user_id: input.actorUserId
        })

      if (recordWindowError || !recordedFileData) {
        throw createSubmissionMutationError(
          recordWindowError,
          "Unable to record the submission upload window."
        )
      }

      return {
        file: parseSubmissionFileRow(recordedFileData),
        uploadUrl: signedUrl.uploadUrl,
        expiresInSeconds: signedUrl.expiresInSeconds
      }
    }
  )
}

/**
 * Byte-verifies a pending R2 object before atomically marking it available.
 *
 * @param input - Actor, tenant, submission, and file identifiers.
 * @param deps - Optional trusted database and storage dependencies.
 * @returns Available file metadata wrapped for a thin route response.
 * @throws SubmissionServiceError when ownership, provider verification, or RPC fails.
 */
export async function completeInternalSubmissionFile(
  input: CompleteInternalSubmissionFileInput,
  deps: SubmissionServiceDeps = {}
): Promise<CompleteInternalSubmissionFileResponse> {
  return runSubmissionOperation(
    "complete_internal_submission_file",
    input,
    async (): Promise<CompleteInternalSubmissionFileResponse> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot complete internal submission files."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      assertSubmissionCreatorEditableState(submission, input.actorUserId)
      const files = await listSubmissionFiles(
        client,
        input.organizationId,
        input.submissionId
      )
      const file = files.find(
        (candidate: SubmissionFile): boolean => candidate.id === input.fileId
      )

      if (!file) {
        const cancelled = await cleanupCancelledCompletionRace(
          client,
          input,
          deps
        )

        if (cancelled) {
          throw new SubmissionServiceError(
            "This submission file upload was cancelled.",
            409
          )
        }

        throw new SubmissionServiceError(
          "Submission file allocation was not found.",
          404
        )
      }

      if (file.status === "available") {
        return { file }
      }

      if (!file.expectedChecksumSha256) {
        throw new SubmissionServiceError(
          "This pending upload must be replaced before it can be verified.",
          409
        )
      }

      const verifyUpload =
        deps.verifySubmissionUpload ?? defaultVerifySubmissionUpload
      await verifyUpload({
        storageKey: file.storageKey,
        contentType: file.contentType,
        byteSize: file.byteSize,
        checksumSha256: file.expectedChecksumSha256
      })

      const { data, error } = await client.rpc(
        "complete_internal_submission_file",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_file_id: file.id,
          target_storage_key: file.storageKey,
          target_content_type: file.contentType,
          target_byte_size: file.byteSize,
          target_checksum_sha256: file.expectedChecksumSha256,
          target_actor_user_id: input.actorUserId
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to complete submission file upload."
        )
      }

      return { file: parseSubmissionFileRow(data) }
    }
  )
}

/**
 * Tombstones one active draft file and best-effort deletes its private object.
 *
 * The database transition runs first so a provider cleanup outage cannot keep
 * the draft field permanently occupied. The tombstone retains the exact key for
 * a later cleanup retry when deletion fails.
 *
 * @param input - Actor, tenant, submission, and active file identifiers.
 * @param deps - Optional trusted database and storage dependencies.
 * @returns Superseded file identity and retained cleanup key.
 * @throws SubmissionServiceError when ownership or the state transition fails.
 */
export async function supersedeInternalSubmissionFile(
  input: SupersedeInternalSubmissionFileInput,
  deps: SubmissionServiceDeps = {}
): Promise<SupersedeInternalSubmissionFileResponse> {
  return runSubmissionOperation(
    "supersede_internal_submission_file",
    input,
    async (): Promise<SupersedeInternalSubmissionFileResponse> => {
      const client = getSubmissionClient(deps)

      await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:edit",
        "You cannot replace internal submission files."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )

      assertSubmissionCreatorEditableState(submission, input.actorUserId)

      const { data, error } = await client.rpc(
        "supersede_internal_submission_file",
        {
          target_org_id: input.organizationId,
          target_submission_id: input.submissionId,
          target_file_id: input.fileId,
          target_actor_user_id: input.actorUserId
        }
      )

      if (error || !data) {
        throw createSubmissionMutationError(
          error,
          "Unable to replace submission file."
        )
      }

      const storageKey = readSupersededStorageKey(data)
      const deleteObject =
        deps.deleteSubmissionStorageObject ??
        defaultDeleteSubmissionStorageObject

      try {
        await deleteObject({ storageKey })
      } catch (error: unknown) {
        console.warn("submission_file_cleanup_deferred", {
          organizationId: input.organizationId,
          submissionId: input.submissionId,
          fileId: input.fileId,
          reason:
            error instanceof Error
              ? error.name
              : "Unknown submission object cleanup error"
        })
      }

      return { fileId: input.fileId, storageKey }
    }
  )
}

/**
 * Creates a signed private download URL for an available visible submission file.
 *
 * @param input - Actor, tenant, submission, and file identifiers.
 * @param deps - Optional trusted database and storage dependencies.
 * @returns Signed attachment URL and expiry.
 * @throws SubmissionServiceError when the file is hidden, pending, or cannot be signed.
 */
export async function createInternalSubmissionFileDownloadUrl(
  input: CreateInternalSubmissionFileDownloadUrlInput,
  deps: SubmissionServiceDeps = {}
): Promise<CreateInternalSubmissionFileDownloadUrlResponse> {
  return runSubmissionOperation(
    "create_internal_submission_file_download_url",
    input,
    async (): Promise<CreateInternalSubmissionFileDownloadUrlResponse> => {
      const client = getSubmissionClient(deps)
      const role = await requireSubmissionPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "submissions:view",
        "You cannot download internal submission files."
      )
      const submission = await getSubmissionById(
        client,
        input.organizationId,
        input.submissionId
      )
      assertSubmissionVisible(role, submission, input.actorUserId)
      const files = await listSubmissionFiles(
        client,
        input.organizationId,
        input.submissionId,
        role === "external_reviewer"
          ? ["available"]
          : ["upload_pending", "available"]
      )
      const file = files.find(
        (candidate: SubmissionFile): boolean => candidate.id === input.fileId
      )

      if (!file) {
        throw new SubmissionServiceError("Submission file was not found.", 404)
      }

      if (file.status !== "available") {
        throw new SubmissionServiceError(
          "Submission file is not available for download.",
          409
        )
      }

      const createSignedDownloadUrl =
        deps.createSignedSubmissionDownloadUrl ??
        defaultCreateSignedSubmissionDownloadUrl
      const signedUrl = await createSignedDownloadUrl({
        storageKey: file.storageKey,
        downloadFilename: file.originalFilename
      })

      return {
        downloadUrl: signedUrl.downloadUrl,
        expiresInSeconds: signedUrl.expiresInSeconds
      }
    }
  )
}

function requireSnapshotFileField(
  submission: Submission,
  fieldKey: string
): void {
  const fileFieldExists = submission.templateSnapshot.blocks.some(
    (block): boolean =>
      block.type === "file_field" && block.fieldKey === fieldKey
  )

  if (!fileFieldExists) {
    throw new SubmissionServiceError(
      "Submission file field was not found.",
      400
    )
  }
}

function assertReusablePendingAllocation(
  file: SubmissionFile,
  expected: {
    actorUserId: string
    originalFilename: string
    safeFilename: string
    contentType: string
    byteSize: number
    checksumSha256: string
  }
): void {
  if (file.status !== "upload_pending") {
    throw new SubmissionServiceError(
      "This submission field already has an available file.",
      409
    )
  }

  if (file.uploadedBy !== expected.actorUserId) {
    throw new SubmissionServiceError(
      "Only the submission creator may resume this file upload.",
      403
    )
  }

  if (
    file.originalFilename !== expected.originalFilename ||
    file.safeFilename !== expected.safeFilename ||
    file.contentType !== expected.contentType ||
    file.byteSize !== expected.byteSize ||
    file.expectedChecksumSha256 !== expected.checksumSha256
  ) {
    throw new SubmissionServiceError(
      "Pending submission file metadata does not match this upload.",
      409
    )
  }
}

function readSupersededStorageKey(value: unknown): string {
  if (
    !value ||
    typeof value !== "object" ||
    !("storage_key" in value) ||
    typeof value.storage_key !== "string" ||
    value.storage_key.length === 0
  ) {
    throw new SubmissionServiceError(
      "Database returned an invalid superseded file record.",
      500
    )
  }

  return value.storage_key
}

function assertSubmissionCreatorEditableState(
  submission: Submission,
  actorUserId: string
): void {
  if (submission.createdBy !== actorUserId) {
    throw new SubmissionServiceError(
      "Only the submission creator may change draft files.",
      403
    )
  }

  if (submission.status !== "draft" && submission.status !== "needs_changes") {
    throw new SubmissionServiceError(
      "Files cannot be changed in this submission status.",
      409
    )
  }
}

async function cleanupCancelledCompletionRace(
  client: ReturnType<typeof getSubmissionClient>,
  input: CompleteInternalSubmissionFileInput,
  deps: SubmissionServiceDeps
): Promise<boolean> {
  const { data, error } = await client
    .from("submission_files")
    .select("id,status,storage_key,storage_cleaned_at")
    .eq("org_id", input.organizationId)
    .eq("submission_id", input.submissionId)
    .eq("id", input.fileId)
    .maybeSingle()

  if (error) {
    throw createSubmissionMutationError(
      error,
      "Unable to verify the cancelled submission upload."
    )
  }

  if (!data || data.status !== "superseded") {
    return false
  }

  if (data.storage_cleaned_at === null) {
    const deleteObject =
      deps.deleteSubmissionStorageObject ?? defaultDeleteSubmissionStorageObject

    try {
      await deleteObject({ storageKey: data.storage_key })
    } catch (cleanupError: unknown) {
      console.warn("submission_file_completion_race_cleanup_deferred", {
        organizationId: input.organizationId,
        submissionId: input.submissionId,
        fileId: input.fileId,
        reason:
          cleanupError instanceof Error
            ? cleanupError.name
            : "Unknown submission object cleanup error"
      })
    }
  }

  return true
}
