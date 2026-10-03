import { randomBytes } from "node:crypto"

import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { recordAuditLog as defaultRecordAuditLog } from "@/services/audit-service"
import { hashToken } from "@/services/document-signing/token-security"
import { type LogValue, runOperation } from "@/services/operation"
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
import { isStructuredAnswerBlock } from "@/types/template-answer"
import { isTemplateBlockVisible } from "@/types/template-visibility"
import { requireTemplateAccess, type TemplateAccessInput } from "@/services/templates/access"
import { TemplateServiceError } from "@/services/templates/errors"
import { mapDocumentTemplate } from "@/services/templates/shared"

/**
 * Retention marker written when a public upload is allocated.
 *
 * `submission_files.cleanup_after` is immutable once a row leaves
 * `upload_pending` (see enforce_submission_file_update), and the scheduled
 * cleanup only reclaims `superseded` objects, so this value is set once here.
 * The nightly expiry supersedes an upload once this window has elapsed, and
 * every file of a public draft nobody has saved or uploaded to for as long.
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

export type CreatePublicFormLinkInput = TemplateAccessInput & {
  expiresAt?: string | null
  maxSubmissions?: number | null
}

export type DisablePublicFormLinkInput = TemplateAccessInput & {
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
  /** The answers already in a document sent to answer, shown filled in. */
  answers: Record<string, unknown>
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
  recordAuditLog?: (input: Parameters<typeof defaultRecordAuditLog>[0]) => Promise<unknown>
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

const linkLimitsSchema = z.object({
  expiresAt: z.iso.datetime({ local: true, offset: true, error: "Choose a valid expiry date." }).nullish(),
  maxSubmissions: z.number().int().positive("The submission limit must be a whole number above zero.").nullish(),
})

function runPublicLinkOperation<T>(
  operationName: string,
  input: TemplateAccessInput,
  operation: () => Promise<T>
): Promise<T> {
  const identifiers: Record<string, LogValue> = { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId }
  return runOperation("public_form", toPublicFormServiceError, operationName, identifiers, operation)
}

function toPublicFormServiceError(error: unknown): PublicFormServiceError {
  if (error instanceof PublicFormServiceError) return error
  if (error instanceof TemplateServiceError) return new PublicFormServiceError(error.message, error.statusCode)
  return new PublicFormServiceError("Public form link service failed.", 500)
}

// Whoever may edit a template may open it to the public.
async function requireLinkManager(client: ReturnType<typeof createAdminClient>, input: TemplateAccessInput): Promise<void> {
  const access = { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: input.templateId }
  await requireTemplateAccess(client as never, access, "editor", "You do not have permission to manage public form links.")
}

async function auditLink(
  deps: PublicFormServiceDeps,
  input: TemplateAccessInput,
  action: "public_form_link.created" | "public_form_link.disabled",
  linkId: string
): Promise<void> {
  try {
    await (deps.recordAuditLog ?? defaultRecordAuditLog)({
      action,
      actorUserId: input.actorUserId,
      metadata: { templateId: input.templateId },
      organizationId: input.organizationId,
      targetId: linkId,
      targetType: "public_form_link",
    })
  } catch (error: unknown) {
    // The link already changed; a lost audit row is reported, not undone.
    console.warn("public_form_link_audit_failed", { action, linkId, reason: error instanceof Error ? error.message : "Unknown audit error" })
  }
}

/**
 * Generates a shareable public form link for a published template.
 *
 * @throws PublicFormServiceError 400 for a past expiry or a bad limit, 403/404 without edit access, 400 when unpublished.
 */
export async function createPublicFormLink(
  input: CreatePublicFormLinkInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink> {
  return runPublicLinkOperation("create_public_form_link", input, async () => {
    const client = getClient(deps)
    const timestamp = nowIso(deps)
    const limits = linkLimitsSchema.safeParse(input)

    if (!limits.success) {
      throw new PublicFormServiceError(limits.error.issues[0]?.message ?? "These link limits are not valid.", 400)
    }

    // A time with no offset counts as UTC, as the database has always read it.
    const expiry = limits.data.expiresAt
    const expiresAt = expiry ? new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(expiry) ? expiry : `${expiry}Z`).toISOString() : null

    if (expiresAt && expiresAt <= timestamp) {
      throw new PublicFormServiceError("Choose an expiry date in the future.", 400)
    }

    await requireLinkManager(client, input)

    const { data: templateData, error: templateError } = await client
      .from("document_templates")
      .select("status")
      .eq("id", input.templateId)
      .eq("org_id", input.organizationId)
      .maybeSingle()

    if (templateError) {
      throw new PublicFormServiceError("Unable to load the template.", 500)
    }

    if ((templateData as { status?: string } | null)?.status !== "published") {
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
        token: (deps.generateTokenImpl ?? generateToken)(),
        status: "active",
        expires_at: expiresAt,
        max_submissions: limits.data.maxSubmissions ?? null,
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

    const link = parsePublicFormLinkRow(data)
    await auditLink(deps, input, "public_form_link.created", link.id)
    return link
  })
}

/**
 * Disables one of a template's links for anyone. A link sent to one person is
 * revoked where it was sent from (send-to-answer), never here.
 *
 * @throws PublicFormServiceError 403/404 without edit access, 404 when the template has no such link.
 */
export async function disablePublicFormLink(
  input: DisablePublicFormLinkInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink> {
  return runPublicLinkOperation("disable_public_form_link", input, async () => {
    const client = getClient(deps)
    await requireLinkManager(client, input)

    const { data, error } = await client
      .from("public_form_links")
      .update({
        status: "disabled",
        updated_at: nowIso(deps),
      })
      .eq("id", input.linkId)
      .eq("org_id", input.organizationId)
      .eq("template_id", input.templateId)
      .is("token_hash", null)
      .select()
      .maybeSingle()

    if (error) {
      throw new PublicFormServiceError("Unable to disable the public form link.", 500)
    }

    if (!data) {
      throw new PublicFormServiceError("Public form link was not found.", 404)
    }

    await auditLink(deps, input, "public_form_link.disabled", input.linkId)
    return parsePublicFormLinkRow(data)
  })
}

/**
 * Lists a template's links for anyone, for someone who may edit it.
 */
export async function listPublicFormLinks(
  input: TemplateAccessInput,
  deps: PublicFormServiceDeps = {}
): Promise<PublicFormLink[]> {
  return runPublicLinkOperation("list_public_form_links", input, async () => {
    const client = getClient(deps)
    await requireLinkManager(client, input)

    const { data, error } = await client
      .from("public_form_links")
      .select("*")
      .eq("org_id", input.organizationId)
      .eq("template_id", input.templateId)
      // Links sent to one person each are listed where they were sent from.
      .is("token_hash", null)
      .order("created_at", { ascending: false })

    if (error || !data) {
      throw new PublicFormServiceError("Unable to load public form links.", 500)
    }

    return data.map((row) => parsePublicFormLinkRow(row))
  })
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
    answers: {},
  })

  let { data: linkRow, error: linkError } = await client
    .from("public_form_links")
    .select("*")
    .eq("token", token)
    .maybeSingle()

  // A link sent to one person is kept only as its token's hash, and only a
  // token shaped as ours can be one.
  if (!linkError && !linkRow && /^[A-Za-z0-9_-]{32,512}$/.test(token)) {
    ;({ data: linkRow, error: linkError } = await client
      .from("public_form_links")
      .select("*")
      .eq("token_hash", hashToken(token))
      .maybeSingle())
  }

  if (linkError || !linkRow) {
    return invalid("not_found")
  }

  const link = parsePublicFormLinkRow(linkRow)

  if (link.status === "disabled") {
    return invalid("disabled", link)
  }

  if (
    link.status === "expired" ||
    (link.expiresAt !== null && new Date(link.expiresAt).getTime() <= now.getTime())
  ) {
    return invalid("expired", link)
  }

  if (
    link.maxSubmissions !== null &&
    link.submissionCount >= link.maxSubmissions
  ) {
    return invalid("max_submissions_reached", link)
  }

  const sent = linkRow as {
    answers_snapshot: Record<string, unknown> | null
    content_snapshot: unknown
    template_revision_snapshot: number | null
    title_snapshot: string | null
  }

  if (sent.content_snapshot) {
    return previewSentLink(client, link, sent, invalid)
  }

  // A public form serves what was published, not the working copy.
  const [templateRes, orgRes] = await Promise.all([
    client
      .from("published_document_templates")
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

  const template = mapDocumentTemplate(templateRes.data as DocumentTemplateRow)

  return {
    valid: true,
    invalidReason: null,
    link,
    template,
    organizationName: (orgRes.data as { name?: string } | null)?.name ?? null,
    answers: {},
  }
}

/**
 * Serves a link sent to one person: what was sent, frozen as it stood, with
 * the answers already in it. It closes while its document is in the trash and
 * opens again if the document comes back.
 */
async function previewSentLink(
  client: ReturnType<typeof createAdminClient>,
  link: PublicFormLink,
  sent: {
    answers_snapshot: Record<string, unknown> | null
    content_snapshot: unknown
    template_revision_snapshot: number | null
    title_snapshot: string | null
  },
  invalid: (reason: PublicFormLinkPreview["invalidReason"], link?: PublicFormLink | null) => PublicFormLinkPreview
): Promise<PublicFormLinkPreview> {
  const [templateRes, orgRes, documentRes] = await Promise.all([
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
    link.documentId
      ? client
          .from("documents")
          .select("lifecycle_state")
          .eq("id", link.documentId)
          .eq("org_id", link.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const lifecycle = (documentRes.data as { lifecycle_state?: string } | null)?.lifecycle_state

  if (templateRes.error || !templateRes.data || documentRes.error || (link.documentId && lifecycle !== "active")) {
    return invalid("not_found", link)
  }

  return {
    valid: true,
    invalidReason: null,
    link,
    template: {
      ...mapDocumentTemplate(templateRes.data as DocumentTemplateRow),
      content: parseTemplateContent(sent.content_snapshot),
      revision: sent.template_revision_snapshot ?? 1,
      title: sent.title_snapshot ?? "",
    },
    organizationName: (orgRes.data as { name?: string } | null)?.name ?? null,
    answers: sent.answers_snapshot ?? {},
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
 * Structured answers are parsed from JSON text and checked by the validator.
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
      continue
    }

    // Several choices, a grid or a table arrive as one JSON string; blank is unanswered.
    const raw = values[block.fieldKey]

    if (isStructuredAnswerBlock(block) && typeof raw === "string") {
      if (raw.trim() === "") {
        delete coerced[block.fieldKey]
        continue
      }

      try {
        coerced[block.fieldKey] = JSON.parse(raw) as unknown
      } catch {
        // Left as text, which the validator refuses for this kind with a 400.
      }
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
 * Maps a refused atomic public submission to a visitor-safe error.
 *
 * The database refuses the whole submission, so a refusal never uses any of
 * the link's capacity.
 */
function createPublicSubmissionError(
  error: { code?: string } | null
): PublicFormServiceError {
  switch (error?.code) {
    case "55000":
      return new PublicFormServiceError(
        "Unable to process submission. The link may have reached its limit or expired.",
        409
      )
    case "40001":
      return new PublicFormServiceError(
        "This form draft changed in another tab. Reload and try again.",
        409
      )
    case "22023":
    case "23514":
      return new PublicFormServiceError("Your submission is not valid.", 400)
    default:
      return new PublicFormServiceError(
        "Unable to save your submission. Please try again.",
        500
      )
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

  // One database call saves the submission and claims the link's capacity
  // together. It locks the link, re-checks status, expiry, and the ceiling,
  // and guards a draft by its revision, so a refused or failed save never uses
  // a slot and concurrent submitters cannot exceed the ceiling.
  const timestamp = nowIso(deps)
  const { data, error } = await client.rpc("submit_public_form_entry", {
    target_public_form_token: input.token,
    target_public_draft_token: draft ? (input.draftToken ?? null) : null,
    target_expected_revision: draft ? draft.revision : null,
    target_submission_id: draft ? null : createId(deps),
    target_title: draft
      ? null
      : input.title?.trim() || `${template.title} (Public)`,
    target_template_id: draft ? null : template.id,
    target_template_revision: draft ? null : template.revision,
    target_template_snapshot: draft ? null : template.content,
    target_values: normalizedValues,
    target_submitted_at: timestamp,
  })

  if (error || !data) {
    throw createPublicSubmissionError(error)
  }

  return {
    submissionId: data.id,
    organizationId: data.org_id,
    status: "submitted",
    submittedAt: timestamp,
  }
}
