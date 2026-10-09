import {
  createSafeSubmissionFilename,
  createSignedSubmissionUploadUrl as defaultCreateSignedSubmissionUploadUrl,
  verifySubmissionUpload as defaultVerifySubmissionUpload,
} from "@/services/submission-storage-service"
import type { PublicFormLink } from "@/types/public-link"
import type { TemplateBlock, TemplateContent } from "@/types/template"
import { isTemplateBlockVisible } from "@/types/template-visibility"
import { createPublicDraft, resolvePublicDraft } from "@/services/public-forms/draft-service"
import { requireValidLink } from "@/services/public-forms/link-service"
import {
  type CompletePublicFormFileUploadInput,
  type CreatePublicFormFileUploadUrlInput,
  type CreatePublicFormFileUploadUrlResponse,
  PUBLIC_UPLOAD_CLEANUP_MS,
  type PublicFormServiceDeps,
  PublicFormServiceError,
  type SupersedePublicFormFileInput,
  createId,
  draftTokenSchema,
  getClient,
  nowIso,
  publicFileIdSchema,
  uploadRequestSchema,
} from "@/services/public-forms/shared"

/**
 * Asserts the requested field is a file field declared by this template.
 *
 * Without this an anonymous caller could allocate objects under invented field
 * keys that no reviewer will ever see but that still consume storage.
 */
function requireFileField(
  snapshot: TemplateContent,
  fieldKey: string
): Extract<TemplateBlock, { type: "file_field" }> {
  const block = snapshot.blocks.find(
    (candidate: TemplateBlock) =>
      "fieldKey" in candidate && candidate.fieldKey === fieldKey
  )

  if (!block || block.type !== "file_field") {
    throw new PublicFormServiceError(
      "This form does not accept a file for that field.",
      400
    )
  }

  return block
}

/**
 * Creates a create-only signed upload URL for a file field on a public form.
 *
 * The first call allocates the draft submission that parents the file, because
 * `submission_files` requires a real submission id both as a column and inside
 * the canonical object key.
 */
export async function createPublicFormFileUploadUrl(
  input: CreatePublicFormFileUploadUrlInput,
  deps: PublicFormServiceDeps = {}
): Promise<CreatePublicFormFileUploadUrlResponse> {
  const parsed = uploadRequestSchema.safeParse(input)

  if (!parsed.success) {
    throw new PublicFormServiceError(
      parsed.error.issues[0]?.message ?? "This upload request is not valid.",
      400
    )
  }

  const client = getClient(deps)
  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink

  const { draft, draftToken } = input.draftToken
    ? {
        draft: await resolvePublicDraft(input.draftToken, link.id, deps),
        draftToken: input.draftToken,
      }
    : await createPublicDraft(input.token, preview, {}, deps)

  const fileField = requireFileField(draft.snapshot, parsed.data.fieldKey)

  if (!isTemplateBlockVisible(draft.snapshot, fileField, draft.values)) {
    throw new PublicFormServiceError(
      "This file field is currently hidden.",
      400
    )
  }

  const safeFilename = createSafeSubmissionFilename(parsed.data.originalFilename)
  const fileId = createId(deps)
  const signUploadUrl =
    deps.createSignedSubmissionUploadUrl ??
    defaultCreateSignedSubmissionUploadUrl

  const signedUrl = await signUploadUrl({
    organizationId: draft.organizationId,
    submissionId: draft.id,
    fieldKey: parsed.data.fieldKey,
    fileId,
    safeFilename,
    contentType: parsed.data.contentType,
    byteSize: parsed.data.byteSize,
    checksumSha256: parsed.data.checksumSha256,
  })

  const timestamp = nowIso(deps)
  const cleanupAfter = new Date(
    new Date(timestamp).getTime() + PUBLIC_UPLOAD_CLEANUP_MS
  ).toISOString()

  const { error } = await client.from("submission_files").insert({
    id: fileId,
    org_id: draft.organizationId,
    submission_id: draft.id,
    field_key: parsed.data.fieldKey,
    status: "upload_pending",
    storage_key: signedUrl.storageKey,
    original_filename: parsed.data.originalFilename,
    safe_filename: safeFilename,
    content_type: parsed.data.contentType,
    byte_size: parsed.data.byteSize,
    expected_checksum_sha256: parsed.data.checksumSha256,
    checksum_sha256: null,
    uploaded_by: null,
    created_at: timestamp,
    updated_at: timestamp,
    cleanup_after: cleanupAfter,
  } as never)

  if (error) {
    throw new PublicFormServiceError("Unable to initiate file upload.", 500)
  }

  return {
    fileId,
    draftToken,
    uploadUrl: signedUrl.uploadUrl,
    safeFilename,
    expiresInSeconds: signedUrl.expiresInSeconds,
  }
}

/**
 * Verifies uploaded bytes in R2 before a public file counts as available.
 *
 * The browser's claimed checksum is never trusted: the stored object is
 * inspected and must match the size, type, and checksum bound at allocation.
 */
export async function completePublicFormFileUpload(
  input: CompletePublicFormFileUploadInput,
  deps: PublicFormServiceDeps = {}
): Promise<{ fileId: string; status: "available" }> {
  const client = getClient(deps)
  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink
  const draft = await resolvePublicDraft(input.draftToken, link.id, deps)

  const { data, error } = await client
    .from("submission_files")
    .select(
      "id,org_id,submission_id,storage_key,content_type,byte_size,expected_checksum_sha256,status"
    )
    .eq("id", input.fileId)
    .eq("submission_id", draft.id)
    .eq("org_id", draft.organizationId)
    .eq("status", "upload_pending")
    .maybeSingle()

  if (error) {
    throw new PublicFormServiceError("Unable to verify your upload.", 500)
  }

  if (!data) {
    throw new PublicFormServiceError("This upload is no longer pending.", 404)
  }

  const file = data as {
    storage_key: string
    content_type: string
    byte_size: number
    expected_checksum_sha256: string | null
  }

  if (!file.expected_checksum_sha256) {
    throw new PublicFormServiceError("This upload cannot be verified.", 409)
  }

  const verifyUpload =
    deps.verifySubmissionUpload ?? defaultVerifySubmissionUpload

  await verifyUpload({
    storageKey: file.storage_key,
    contentType: file.content_type,
    byteSize: file.byte_size,
    checksumSha256: file.expected_checksum_sha256,
  })

  const timestamp = nowIso(deps)
  const { data: updated, error: updateError } = await client
    .from("submission_files")
    .update({
      status: "available",
      checksum_sha256: file.expected_checksum_sha256,
      available_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", input.fileId)
    .eq("org_id", draft.organizationId)
    .eq("submission_id", draft.id)
    .eq("status", "upload_pending")
    .select("id")
    .maybeSingle()

  if (updateError || !updated) {
    throw new PublicFormServiceError("Unable to record your upload.", 409)
  }

  return { fileId: input.fileId, status: "available" }
}

/**
 * Supersedes a public draft file through the token-scoped database transition.
 *
 * The database RPC validates both opaque tokens and the file's exact parent
 * draft before placing the object into the existing recoverable cleanup queue.
 *
 * @param input - Public link token, draft handle, and active file id.
 * @param deps - Optional deterministic service dependencies.
 * @returns The superseded file identifier.
 * @throws PublicFormServiceError when scope validation or transition fails.
 */
export async function supersedePublicFormFile(
  input: SupersedePublicFormFileInput,
  deps: PublicFormServiceDeps = {}
): Promise<{ fileId: string }> {
  if (
    !draftTokenSchema.safeParse(input.draftToken).success ||
    !publicFileIdSchema.safeParse(input.fileId).success
  ) {
    throw new PublicFormServiceError(
      "This public form file could not be removed.",
      400
    )
  }

  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink
  await resolvePublicDraft(input.draftToken, link.id, deps)

  const client = getClient(deps)
  const { data, error } = await client.rpc(
    "supersede_public_submission_file",
    {
      target_public_form_token: input.token,
      target_public_draft_token: input.draftToken,
      target_file_id: input.fileId,
    }
  )

  if (error || !data) {
    throw new PublicFormServiceError(
      "This public form file is no longer available to remove.",
      409
    )
  }

  return { fileId: input.fileId }
}
