import { hashToken } from "@/services/document-signing/token-security"
import { answeringAs } from "@/types/box-signers"
import { normalizeSubmissionDraftAnswers } from "@/services/submissions/validation"
import type { PublicFormLink } from "@/types/public-link"
import { SubmissionDomainError } from "@/types/submission"
import type { DocumentTemplate, TemplateContent } from "@/types/template"
import { parseTemplateContent } from "@/types/template"
import { requireValidLink } from "@/services/public-forms/link-service"
import {
  DRAFT_CHANGED,
  FORM_CHANGED,
  type PublicDraft,
  type PublicFormDraftCheckpoint,
  type PublicFormDraftState,
  type PublicFormLinkPreview,
  type PublicFormServiceDeps,
  PublicFormServiceError,
  type SavePublicFormDraftInput,
  createId,
  draftTokenSchema,
  generateDraftToken,
  getClient,
  nowIso,
  publicDraftCheckpointSchema,
} from "@/services/public-forms/shared"

/**
 * Resolves the draft a visitor's handle refers to, scoped to this link.
 *
 * The handle is matched together with the link id and a `draft` status, so a
 * handle issued for one link can never resolve a draft belonging to another
 * link, and an already-submitted row can never be reopened.
 */
export async function resolvePublicDraft(
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
  // tenant-scope: an anonymous visitor holds only the draft handle; its hash plus the link id find the row
  const { data, error } = await client
    .from("submissions")
    .select(
      "id,org_id,template_snapshot,values,revision,public_form_link_id,status"
    )
    .eq("public_draft_token", hashToken(draftToken))
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

  return mapPublicDraft(data)
}

function mapPublicDraft(data: unknown): PublicDraft {
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
 * The database stores the form the link serves, as a submission does, and
 * refuses when it is not the revision these answers were checked against.
 */
export async function createPublicDraft(
  token: string,
  preview: PublicFormLinkPreview,
  values: Record<string, unknown>,
  deps: PublicFormServiceDeps
): Promise<{ draft: PublicDraft; draftToken: string }> {
  const template = preview.template as DocumentTemplate
  const draftToken = (deps.generateDraftTokenImpl ?? generateDraftToken)()
  const { data, error } = await getClient(deps).rpc("start_public_form_draft", {
    target_public_form_token: token,
    target_public_draft_token: draftToken,
    target_submission_id: createId(deps),
    target_title: `${template.title} (Public)`,
    target_template_revision: template.revision,
    target_values: values,
    target_created_at: nowIso(deps),
  })

  if (error || !data) {
    throw createPublicSubmissionError(error, false)
  }

  return { draft: mapPublicDraft(data), draftToken }
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
  // Submit enforces this too; here it keeps a reload from showing someone else's box filled.
  // Read against the form the draft was opened on, which a republish does not change.
  const posted = (snapshot: TemplateContent) => answeringAs(snapshot, parsed.data.values, preview.answers, link.signer).values

  if (!parsed.data.draftToken) {
    const values = await normalizePublicDraftValues(
      (preview.template as DocumentTemplate).content,
      posted((preview.template as DocumentTemplate).content)
    )
    const created = await createPublicDraft(input.token, preview, values, deps)

    return {
      activeFileFieldKeys: [],
      draftToken: created.draftToken,
      revision: 1,
    }
  }

  const draft = await resolvePublicDraft(parsed.data.draftToken, link.id, deps)

  if (draft.revision !== parsed.data.expectedRevision) {
    throw new PublicFormServiceError(DRAFT_CHANGED, 409)
  }

  const values = await normalizePublicDraftValues(draft.snapshot, posted(draft.snapshot))
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
    .eq("public_draft_token", hashToken(parsed.data.draftToken))
    .eq("status", "draft")
    .eq("revision", draft.revision)
    .select("revision")
    .maybeSingle()

  if (error) {
    throw new PublicFormServiceError("Unable to save your form draft.", 500)
  }

  if (!data) {
    throw new PublicFormServiceError(DRAFT_CHANGED, 409)
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
 * Reads the file field keys whose objects were verified for this draft.
 */
export async function loadAvailableFileFieldKeys(
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
 * the link's capacity. A conflict is the visitor's own draft moving on in
 * another tab, or, without a draft, the form published again since it was
 * opened.
 */
export function createPublicSubmissionError(
  error: { code?: string } | null,
  submitsDraft: boolean
): PublicFormServiceError {
  switch (error?.code) {
    case "55000":
      return new PublicFormServiceError(
        "Unable to process submission. The link may have reached its limit or expired.",
        409
      )
    case "40001":
      return new PublicFormServiceError(submitsDraft ? DRAFT_CHANGED : FORM_CHANGED, 409)
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
