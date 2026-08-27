import { randomBytes } from "node:crypto"

import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  createSafeSubmissionFilename,
  createSignedSubmissionUploadUrl as defaultCreateSignedSubmissionUploadUrl,
  verifySubmissionUpload as defaultVerifySubmissionUpload,
} from "@/services/submission-storage-service"
import {
  normalizeSubmissionDraftAnswers,
  validateSubmissionForSubmit,
} from "@/services/submissions/validation"
import type { PublicFormLink } from "@/types/public-link"
import { parsePublicFormLinkRow } from "@/types/public-link"
import { SubmissionDomainError } from "@/types/submission"
import type {
  DocumentTemplate,
  DocumentTemplateRow,
  TemplateBlock,
  TemplateContent,
} from "@/types/template"
import { parseTemplateContent } from "@/types/template"
import { isTemplateBlockVisible } from "@/types/template-visibility"

/**
 * Retention marker written when a public upload is allocated.
 *
 * `submission_files.cleanup_after` is immutable once a row leaves
 * `upload_pending` (see enforce_submission_file_update), and the scheduled
 * cleanup only reclaims `superseded` objects, so this value is set once here.
 */
const PUBLIC_UPLOAD_CLEANUP_MS = 24 * 60 * 60 * 1000

function generateToken(): string {
  return randomBytes(24).toString("hex")
}

function generateDraftToken(): string {
  return randomBytes(32).toString("hex")
}

export class PublicFormServiceError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "PublicFormServiceError"
    this.statusCode = statusCode
  }
}

export type CreatePublicFormLinkInput = {
  actorUserId: string
  organizationId: string
  templateId: string
  expiresAt?: string | null
  maxSubmissions?: number | null
}

export type DisablePublicFormLinkInput = {
  actorUserId: string
  organizationId: string
  linkId: string
}

export type PublicFormLinkPreview = {
  valid: boolean
  invalidReason:
    | "not_found"
    | "disabled"
    | "expired"
    | "max_submissions_reached"
    | null
  link: PublicFormLink | null
  template: DocumentTemplate | null
  organizationName: string | null
}

export type SubmitPublicFormInput = {
  token: string
  draftToken?: string | null
  expectedRevision?: number | null
  title?: string
  values: Record<string, unknown>
}

export type PublicSubmissionResult = {
  submissionId: string
  organizationId: string
  status: string
  submittedAt: string
}

export type CreatePublicFormFileUploadUrlInput = {
  token: string
  draftToken?: string | null
  fieldKey: string
  originalFilename: string
  contentType: string
  byteSize: number
  checksumSha256: string
}

export type SavePublicFormDraftInput = {
  token: string
  draftToken?: string | null
  expectedRevision?: number | null
  values: Record<string, unknown>
}

export type PublicFormDraftCheckpoint = {
  activeFileFieldKeys: string[]
  draftToken: string
  revision: number
}

export type PublicFormDraftFile = {
  fileId: string
  fieldKey: string
  originalFilename: string
}

export type PublicFormDraftState = PublicFormDraftCheckpoint & {
  values: Record<string, unknown>
  files: PublicFormDraftFile[]
}

export type CreatePublicFormFileUploadUrlResponse = {
  fileId: string
  draftToken: string
  uploadUrl: string
  storageKey: string
  safeFilename: string
  expiresInSeconds: number
}

export type CompletePublicFormFileUploadInput = {
  token: string
  draftToken: string
  fileId: string
}

export type SupersedePublicFormFileInput = {
  token: string
  draftToken: string
  fileId: string
}

export type PublicFormServiceDeps = {
  client?: ReturnType<typeof createAdminClient>
  generateTokenImpl?: () => string
  generateDraftTokenImpl?: () => string
  createId?: () => string
  now?: () => Date
  createSignedSubmissionUploadUrl?: typeof defaultCreateSignedSubmissionUploadUrl
  verifySubmissionUpload?: typeof defaultVerifySubmissionUpload
}

/** A public draft submission resolved from an anonymous visitor's handle. */
type PublicDraft = {
  id: string
  organizationId: string
  linkId: string
  snapshot: TemplateContent
  values: Record<string, unknown>
  revision: number
}

const uploadRequestSchema = z.object({
  fieldKey: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_-]{0,79}$/,
      "File field key is not valid for this form."
    ),
  originalFilename: z.string().trim().min(1).max(240),
  contentType: z.string().trim().min(1).max(180),
  byteSize: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "File checksum is invalid."),
})

const draftTokenSchema = z.string().regex(/^[0-9a-f]{64}$/)
const publicFileIdSchema = z.string().uuid()

const publicDraftCheckpointSchema = z
  .object({
    draftToken: draftTokenSchema.nullable().optional(),
    expectedRevision: z.number().int().positive().nullable().optional(),
    values: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, context) => {
    const hasDraftToken = typeof value.draftToken === "string"
    const hasExpectedRevision = typeof value.expectedRevision === "number"

    if (hasDraftToken !== hasExpectedRevision) {
      context.addIssue({
        code: "custom",
        message: "The public form draft revision is missing or invalid.",
        path: ["expectedRevision"],
      })
    }
  })

function getClient(
  deps: PublicFormServiceDeps
): ReturnType<typeof createAdminClient> {
  return deps.client ?? createAdminClient()
}

function nowIso(deps: PublicFormServiceDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString()
}

function createId(deps: PublicFormServiceDeps): string {
  return deps.createId?.() ?? crypto.randomUUID()
}

/**
 * Generates a shareable public form link for a published template.
 */
export async function createPublicFormLink(
  input: CreatePublicFormLinkInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink> {
  const client = getClient(deps)
  const token = (deps.generateTokenImpl ?? generateToken)()
  const timestamp = nowIso(deps)

  const { data: templateData, error: templateError } = await client
    .from("document_templates")
    .select("*")
    .eq("id", input.templateId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (templateError || !templateData) {
    throw new PublicFormServiceError("Template was not found.", 404)
  }

  const templateRow = templateData as DocumentTemplateRow

  if (templateRow.status !== "published") {
    throw new PublicFormServiceError(
      "Public form links can only be created for published templates.",
      400
    )
  }

  const { data, error } = await client
    .from("public_form_links")
    .insert({
      id: createId(deps),
      org_id: input.organizationId,
      template_id: input.templateId,
      token,
      status: "active",
      expires_at: input.expiresAt ?? null,
      max_submissions: input.maxSubmissions ?? null,
      submission_count: 0,
      created_by: input.actorUserId,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select()
    .maybeSingle()

  if (error || !data) {
    throw new PublicFormServiceError("Unable to create public form link.", 500)
  }

  return parsePublicFormLinkRow(data)
}

/**
 * Disables an existing public form link.
 */
export async function disablePublicFormLink(
  input: DisablePublicFormLinkInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink> {
  const client = getClient(deps)

  const { data, error } = await client
    .from("public_form_links")
    .update({
      status: "disabled",
      updated_at: nowIso(deps),
    })
    .eq("id", input.linkId)
    .eq("org_id", input.organizationId)
    .select()
    .maybeSingle()

  if (error || !data) {
    throw new PublicFormServiceError(
      "Public form link was not found or could not be disabled.",
      404
    )
  }

  return parsePublicFormLinkRow(data)
}

/**
 * Lists all public form links for a specific template.
 */
export async function listPublicFormLinks(
  organizationId: string,
  templateId: string,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink[]> {
  const client = getClient(deps)

  const { data, error } = await client
    .from("public_form_links")
    .select("*")
    .eq("org_id", organizationId)
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })

  if (error || !data) {
    throw new PublicFormServiceError("Unable to load public form links.", 500)
  }

  return data.map((row) => parsePublicFormLinkRow(row))
}

/**
 * Fetches public link and template preview data by public token (unauthenticated).
 */
export async function getPublicFormLinkByToken(
  token: string,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLinkPreview> {
  const client = getClient(deps)
  const now = (deps.now ?? (() => new Date()))()
  const invalid = (
    reason: PublicFormLinkPreview["invalidReason"],
    link: PublicFormLink | null = null
  ): PublicFormLinkPreview => ({
    valid: false,
    invalidReason: reason,
    link,
    template: null,
    organizationName: null,
  })

  const { data: linkRow, error: linkError } = await client
    .from("public_form_links")
    .select("*")
    .eq("token", token)
    .maybeSingle()

  if (linkError || !linkRow) {
    return invalid("not_found")
  }

  const link = parsePublicFormLinkRow(linkRow)

  if (link.status === "disabled") {
    return invalid("disabled", link)
  }

  if (
    link.expiresAt !== null &&
    new Date(link.expiresAt).getTime() <= now.getTime()
  ) {
    return invalid("expired", link)
  }

  if (
    link.maxSubmissions !== null &&
    link.submissionCount >= link.maxSubmissions
  ) {
    return invalid("max_submissions_reached", link)
  }

  const [templateRes, orgRes] = await Promise.all([
    client
      .from("document_templates")
      .select("*")
      .eq("id", link.templateId)
      .eq("org_id", link.organizationId)
      .maybeSingle(),
    client
      .from("organizations")
      .select("name")
      .eq("id", link.organizationId)
      .maybeSingle(),
  ])

  if (templateRes.error || !templateRes.data) {
    return invalid("not_found", link)
  }

  const rawTemplate = templateRes.data as DocumentTemplateRow
  const template: DocumentTemplate = {
    id: rawTemplate.id,
    organizationId: rawTemplate.org_id,
    title: rawTemplate.title,
    description: rawTemplate.description,
    category: rawTemplate.category ?? null,
    status: rawTemplate.status,
    revision: rawTemplate.revision,
    content: parseTemplateContent(rawTemplate.content),
    createdBy: rawTemplate.created_by,
    updatedBy: rawTemplate.updated_by,
    publishedBy: rawTemplate.published_by,
    archivedBy: rawTemplate.archived_by,
    createdAt: rawTemplate.created_at,
    updatedAt: rawTemplate.updated_at,
    publishedAt: rawTemplate.published_at,
    archivedAt: rawTemplate.archived_at,
  }

  return {
    valid: true,
    invalidReason: null,
    link,
    template,
    organizationName: (orgRes.data as { name?: string } | null)?.name ?? null,
  }
}

/**
 * Requires a currently valid link, translating an invalid one to a 400.
 */
async function requireValidLink(
  token: string,
  deps: PublicFormServiceDeps
): Promise<PublicFormLinkPreview> {
  const preview = await getPublicFormLinkByToken(token, deps)

  if (!preview.valid || !preview.link || !preview.template) {
    throw new PublicFormServiceError(
      `This public form is not available (${preview.invalidReason ?? "invalid"}).`,
      400
    )
  }

  return preview
}

/**
 * Resolves the draft a visitor's handle refers to, scoped to this link.
 *
 * The handle is matched together with the link id and a `draft` status, so a
 * handle issued for one link can never resolve a draft belonging to another
 * link, and an already-submitted row can never be reopened.
 */
async function resolvePublicDraft(
  draftToken: string,
  linkId: string,
  deps: PublicFormServiceDeps
): Promise<PublicDraft> {
  if (!draftTokenSchema.safeParse(draftToken).success) {
    throw new PublicFormServiceError(
      "This form session is no longer valid.",
      400
    )
  }

  const client = getClient(deps)
  const { data, error } = await client
    .from("submissions")
    .select(
      "id,org_id,template_snapshot,values,revision,public_form_link_id,status"
    )
    .eq("public_draft_token", draftToken)
    .eq("public_form_link_id", linkId)
    .eq("status", "draft")
    .maybeSingle()

  if (error) {
    throw new PublicFormServiceError("Unable to load your form session.", 500)
  }

  if (!data) {
    throw new PublicFormServiceError(
      "This form session is no longer valid.",
      400
    )
  }

  const row = data as {
    id: string
    org_id: string
    template_snapshot: unknown
    values: Record<string, unknown>
    revision: number
    public_form_link_id: string
  }

  return {
    id: row.id,
    organizationId: row.org_id,
    linkId: row.public_form_link_id,
    snapshot: parseTemplateContent(row.template_snapshot),
    values: row.values,
    revision: row.revision,
  }
}

/**
 * Allocates the draft submission that a public visitor's uploads hang off.
 */
async function createPublicDraft(
  preview: PublicFormLinkPreview,
  values: Record<string, unknown>,
  deps: PublicFormServiceDeps
): Promise<{ draft: PublicDraft; draftToken: string }> {
  const client = getClient(deps)
  const link = preview.link as PublicFormLink
  const template = preview.template as DocumentTemplate
  const submissionId = createId(deps)
  const draftToken = (deps.generateDraftTokenImpl ?? generateDraftToken)()
  const timestamp = nowIso(deps)

  const { error } = await client.from("submissions").insert({
    id: submissionId,
    org_id: link.organizationId,
    title: `${template.title} (Public)`,
    template_id: template.id,
    template_revision: template.revision,
    template_snapshot: template.content as never,
    values: values as never,
    status: "draft",
    revision: 1,
    created_by: null,
    updated_by: null,
    submitted_by: null,
    assigned_to: null,
    assigned_by: null,
    public_form_link_id: link.id,
    public_draft_token: draftToken,
    created_at: timestamp,
    updated_at: timestamp,
    submitted_at: null,
    assigned_at: null,
  } as never)

  if (error) {
    throw new PublicFormServiceError("Unable to start your submission.", 500)
  }

  return {
    draft: {
      id: submissionId,
      organizationId: link.organizationId,
      linkId: link.id,
      snapshot: template.content,
      values,
      revision: 1,
    },
    draftToken,
  }
}

async function normalizePublicDraftValues(
  snapshot: TemplateContent,
  values: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    return await normalizeSubmissionDraftAnswers(snapshot, values)
  } catch (error: unknown) {
    if (error instanceof SubmissionDomainError) {
      throw new PublicFormServiceError(error.message, error.statusCode)
    }

    throw new PublicFormServiceError("This form draft is not valid.", 400)
  }
}

/**
 * Persists a public visitor's current scalar answers without submitting.
 *
 * Existing drafts use an optimistic revision predicate so concurrent tabs
 * cannot silently overwrite one another. The returned handle remains scoped
 * to the exact active public link used to create or update the draft.
 *
 * @param input - Public token, optional draft identity, and current answers.
 * @param deps - Optional deterministic service dependencies.
 * @returns The token and revision required by the visitor's next checkpoint.
 * @throws PublicFormServiceError when validation, scope, or revision checks fail.
 */
export async function savePublicFormDraft(
  input: SavePublicFormDraftInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormDraftCheckpoint> {
  const parsed = publicDraftCheckpointSchema.safeParse({
    draftToken: input.draftToken,
    expectedRevision: input.expectedRevision,
    values: input.values,
  })

  if (!parsed.success) {
    throw new PublicFormServiceError(
      parsed.error.issues[0]?.message ?? "This form draft is not valid.",
      400
    )
  }

  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink

  if (!parsed.data.draftToken) {
    const values = await normalizePublicDraftValues(
      (preview.template as DocumentTemplate).content,
      parsed.data.values
    )
    const created = await createPublicDraft(preview, values, deps)

    return {
      activeFileFieldKeys: [],
      draftToken: created.draftToken,
      revision: 1,
    }
  }

  const draft = await resolvePublicDraft(parsed.data.draftToken, link.id, deps)

  if (draft.revision !== parsed.data.expectedRevision) {
    throw new PublicFormServiceError(
      "This form draft changed in another tab. Reload and try again.",
      409
    )
  }

  const values = await normalizePublicDraftValues(
    draft.snapshot,
    parsed.data.values
  )
  const nextRevision = draft.revision + 1
  const client = getClient(deps)
  const { data, error } = await client
    .from("submissions")
    .update({
      values: values as never,
      revision: nextRevision,
      updated_at: nowIso(deps),
    })
    .eq("id", draft.id)
    .eq("org_id", draft.organizationId)
    .eq("public_form_link_id", link.id)
    .eq("public_draft_token", parsed.data.draftToken)
    .eq("status", "draft")
    .eq("revision", draft.revision)
    .select("revision")
    .maybeSingle()

  if (error) {
    throw new PublicFormServiceError("Unable to save your form draft.", 500)
  }

  if (!data) {
    throw new PublicFormServiceError(
      "This form draft changed in another tab. Reload and try again.",
      409
    )
  }

  const activeFileFieldKeys = Array.from(
    await loadAvailableFileFieldKeys(draft, deps)
  ).sort()

  return {
    activeFileFieldKeys,
    draftToken: parsed.data.draftToken,
    revision: nextRevision,
  }
}

/**
 * Restores one token-scoped public draft after a navigation or validation error.
 *
 * @param token - Active public form token.
 * @param draftToken - Opaque visitor-held draft handle.
 * @param deps - Optional deterministic service dependencies.
 * @returns Current scalar values, revision, and verified file display metadata.
 * @throws PublicFormServiceError when the link or draft handle is invalid.
 */
export async function getPublicFormDraftState(
  token: string,
  draftToken: string,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormDraftState> {
  const preview = await requireValidLink(token, deps)
  const link = preview.link as PublicFormLink
  const draft = await resolvePublicDraft(draftToken, link.id, deps)
  const client = getClient(deps)
  const { data, error } = await client
    .from("submission_files")
    .select("id,field_key,original_filename")
    .eq("submission_id", draft.id)
    .eq("org_id", draft.organizationId)
    .eq("status", "available")

  if (error) {
    throw new PublicFormServiceError("Unable to restore your form draft.", 500)
  }

  const files = (data ?? []).map((row) => ({
    fileId: (row as { id: string }).id,
    fieldKey: (row as { field_key: string }).field_key,
    originalFilename: (row as { original_filename: string }).original_filename,
  }))

  return {
    activeFileFieldKeys: files.map((file) => file.fieldKey).sort(),
    draftToken,
    revision: draft.revision,
    values: draft.values,
    files,
  }
}

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
    : await createPublicDraft(preview, {}, deps)

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
    storageKey: signedUrl.storageKey,
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

/**
 * Coerces raw form values to the shapes the shared submission validator expects.
 *
 * Browsers post a checkbox as a string when ticked and omit it entirely when
 * not, so every declared checkbox is resolved to a boolean here. File fields
 * are dropped because their completion is proven by verified storage rows.
 */
function coercePublicFormValues(
  snapshot: TemplateContent,
  values: Record<string, unknown>
): Record<string, unknown> {
  const coerced: Record<string, unknown> = { ...values }

  for (const block of snapshot.blocks) {
    if (!("fieldKey" in block)) {
      continue
    }

    if (block.type === "checkbox_field") {
      coerced[block.fieldKey] =
        values[block.fieldKey] === "true" || values[block.fieldKey] === true
      continue
    }

    if (block.type === "file_field") {
      delete coerced[block.fieldKey]
    }
  }

  return coerced
}

/**
 * Reads the file field keys whose objects were verified for this draft.
 */
async function loadAvailableFileFieldKeys(
  draft: PublicDraft,
  deps: PublicFormServiceDeps
): Promise<ReadonlySet<string>> {
  const client = getClient(deps)
  const { data, error } = await client
    .from("submission_files")
    .select("field_key")
    .eq("submission_id", draft.id)
    .eq("org_id", draft.organizationId)
    .eq("status", "available")

  if (error) {
    throw new PublicFormServiceError("Unable to load your uploaded files.", 500)
  }

  return new Set(
    (data ?? []).map((row) => (row as { field_key: string }).field_key)
  )
}

/**
 * Transitions an allocated public draft to `submitted`.
 */
async function submitPublicDraft(
  context: {
    draft: PublicDraft
    normalizedValues: Record<string, unknown>
    timestamp: string
  },
  deps: PublicFormServiceDeps
): Promise<PublicSubmissionResult> {
  const client = getClient(deps)
  const { draft, normalizedValues, timestamp } = context

  const { data, error } = await client
    .from("submissions")
    .update({
      values: normalizedValues as never,
      status: "submitted",
      submitted_at: timestamp,
      updated_at: timestamp,
      revision: draft.revision + 1,
      public_draft_token: null,
    })
    .eq("id", draft.id)
    .eq("org_id", draft.organizationId)
    .eq("status", "draft")
    .eq("revision", draft.revision)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    throw new PublicFormServiceError(
      error
        ? "Unable to save your submission. Please try again."
        : "This form draft changed in another tab. Reload and try again.",
      error ? 500 : 409
    )
  }

  return {
    submissionId: draft.id,
    organizationId: draft.organizationId,
    status: "submitted",
    submittedAt: timestamp,
  }
}

/**
 * Submits a public form entry anonymously.
 *
 * Values are validated against the template snapshot with the same validator
 * the authenticated path uses, so unknown field keys, missing required answers,
 * and out-of-range values are all rejected server-side.
 */
export async function submitPublicForm(
  input: SubmitPublicFormInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicSubmissionResult> {
  const client = getClient(deps)
  const preview = await requireValidLink(input.token, deps)
  const link = preview.link as PublicFormLink
  const template = preview.template as DocumentTemplate

  const draft = input.draftToken
    ? await resolvePublicDraft(input.draftToken, link.id, deps)
    : null

  if (
    draft &&
    (!Number.isInteger(input.expectedRevision) ||
      input.expectedRevision !== draft.revision)
  ) {
    throw new PublicFormServiceError(
      "This form draft changed in another tab. Reload and try again.",
      409
    )
  }

  const snapshot = draft?.snapshot ?? template.content
  const availableFileFieldKeys = draft
    ? await loadAvailableFileFieldKeys(draft, deps)
    : new Set<string>()

  let normalizedValues: Record<string, unknown>

  try {
    normalizedValues = await validateSubmissionForSubmit(
      snapshot,
      coercePublicFormValues(snapshot, input.values),
      availableFileFieldKeys
    )
  } catch (error: unknown) {
    if (error instanceof SubmissionDomainError) {
      throw new PublicFormServiceError(error.message, error.statusCode)
    }

    throw new PublicFormServiceError("Your submission is not valid.", 400)
  }

  // Claims the link's capacity atomically; the RPC re-checks status, expiry, and
  // the max-submission ceiling in a single statement so concurrent submitters
  // cannot exceed it.
  const { data: countIncremented, error: incError } = await client.rpc(
    "increment_public_form_link_submission_count",
    { p_token: input.token }
  )

  if (incError || !countIncremented) {
    throw new PublicFormServiceError(
      "Unable to process submission. The link may have reached its limit or expired.",
      409
    )
  }

  const timestamp = nowIso(deps)

  if (draft) {
    return submitPublicDraft({ draft, normalizedValues, timestamp }, deps)
  }

  const submissionId = createId(deps)
  const { error: subError } = await client.from("submissions").insert({
    id: submissionId,
    org_id: link.organizationId,
    title: input.title?.trim() || `${template.title} (Public)`,
    template_id: template.id,
    template_revision: template.revision,
    template_snapshot: template.content as never,
    values: normalizedValues as never,
    status: "submitted",
    revision: 1,
    created_by: null,
    updated_by: null,
    submitted_by: null,
    assigned_to: null,
    assigned_by: null,
    public_form_link_id: link.id,
    public_draft_token: null,
    created_at: timestamp,
    updated_at: timestamp,
    submitted_at: timestamp,
    assigned_at: null,
  } as never)

  if (subError) {
    throw new PublicFormServiceError(
      "Unable to save your submission. Please try again.",
      500
    )
  }

  return {
    submissionId,
    organizationId: link.organizationId,
    status: "submitted",
    submittedAt: timestamp,
  }
}
