import type { createAdminClient } from "@/lib/supabase/admin"
import { recordAuditLogBestEffort } from "@/services/audit-service"
import { hashToken } from "@/services/document-signing/token-security"
import type { PublicFormLink } from "@/types/public-link"
import { parsePublicFormLinkRow } from "@/types/public-link"
import type { DocumentTemplateRow } from "@/types/template"
import { parseTemplateContent } from "@/types/template"
import { requireTemplateAccess, type TemplateAccessInput } from "@/services/templates/access"
import { mapDocumentTemplate } from "@/services/templates/shared"
import {
  type CreatePublicFormLinkInput,
  type DisablePublicFormLinkInput,
  type PublicFormLinkPreview,
  type PublicFormServiceDeps,
  PublicFormServiceError,
  createId,
  derivePublicLinkToken,
  getClient,
  linkLimitsSchema,
  nowIso,
  runPublicLinkOperation,
  withToken,
} from "@/services/public-forms/shared"

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
  await recordAuditLogBestEffort(
    {
      action,
      actorUserId: input.actorUserId,
      metadata: { templateId: input.templateId },
      organizationId: input.organizationId,
      targetId: linkId,
      targetType: "public_form_link",
    },
    deps.recordAuditLog
  )
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

    const id = createId(deps)
    const { data, error } = await client
      .from("public_form_links")
      .insert({
        id,
        org_id: input.organizationId,
        template_id: input.templateId,
        token_hash: hashToken((deps.linkToken ?? derivePublicLinkToken)(id)),
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

    const link = withToken(data, deps)
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
      .is("recipient_email", null)
      .select()
      .maybeSingle()

    if (error) {
      throw new PublicFormServiceError("Unable to disable the public form link.", 500)
    }

    if (!data) {
      throw new PublicFormServiceError("Public form link was not found.", 404)
    }

    await auditLink(deps, input, "public_form_link.disabled", input.linkId)
    return withToken(data, deps)
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
      .is("recipient_email", null)
      .order("created_at", { ascending: false })

    if (error || !data) {
      throw new PublicFormServiceError("Unable to load public form links.", 500)
    }

    return data.map((row) => withToken(row, deps))
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

  // Every link is kept only as its token's hash, and only a token shaped as
  // one of ours can be one.
  if (!/^[A-Za-z0-9_-]{10,512}$/.test(token)) {
    return invalid("not_found")
  }

  const { data: linkRow, error: linkError } = await client
    .from("public_form_links")
    .select("*")
    .eq("token_hash", hashToken(token))
    .maybeSingle()

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
export async function requireValidLink(
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
