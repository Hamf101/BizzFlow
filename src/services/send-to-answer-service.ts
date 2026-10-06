import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { recordAuditLogBestEffort, type RecordAuditLogInput } from "@/services/audit-service"
import { sendAnswerRequestEmail } from "@/services/answer-request-email"
import { DocumentSigningServiceError } from "@/services/document-signing/errors"
import { loadGeneratedDocumentView } from "@/services/document-signing/persistence"
import { createSecureToken, hashToken, TOKEN_LIFETIME_MS } from "@/services/document-signing/token-security"
import { requireDocumentAccess } from "@/services/documents/access-service"
import { DocumentServiceError } from "@/services/documents/errors"
import { runOperation } from "@/services/operation"
import { PublicFormServiceError } from "@/services/public-form-service"
import { requireTemplateAccess } from "@/services/templates/access"
import { TemplateServiceError } from "@/services/templates/errors"

type Client = ReturnType<typeof createAdminClient>
type Who = Readonly<{ actorUserId: string; organizationId: string }>
type RequestInput = Who & Readonly<{ linkId: string }>

const FAILED = "Unable to send it to answer."

/** What is sent: a template as published, or a generated document as it stands. */
export type AnswerSource = Readonly<{ kind: "template"; templateId: string }> | Readonly<{ kind: "document"; documentId: string }>

export type SendToAnswerInput = Readonly<{
  actorUserId: string
  emails: readonly string[]
  organizationId: string
  source: AnswerSource
}>

/** One person's request to answer, as the email to them needs it. */
export type AnswerRequest = Readonly<{
  linkId: string
  organizationName: string
  recipientEmail: string
  senderName: string
  title: string
  token: string
}>

/** What became of one person's link. */
export type SentAnswerRequest = Readonly<{
  delivered: boolean
  email: string
  linkId: string
  /** The link's secret, only when its email could not go, to pass on another way. It is never shown again. */
  token: string | null
}>

export type SendToAnswerDeps = {
  client?: ReturnType<typeof createAdminClient>
  createId?: () => string
  createToken?: () => string
  now?: () => Date
  recordAuditLog?: (input: RecordAuditLogInput) => Promise<unknown>
  /** Emails one request; a failure keeps the link, which goes back to the sender instead. */
  sendRequest?: (request: AnswerRequest) => Promise<void>
}

/** Most people one send reaches. */
export const MAX_ANSWER_RECIPIENTS = 10

const emailsSchema = z
  .array(z.string().trim().toLowerCase().pipe(z.email().max(320)))
  .min(1, "Add at least one email address.")
  .transform((emails) => [...new Set(emails)])
  .pipe(z.array(z.string()).max(MAX_ANSWER_RECIPIENTS, `Send to at most ${MAX_ANSWER_RECIPIENTS} people at once.`))

type Snapshot = Readonly<{
  answers: Record<string, unknown> | null
  content: unknown
  documentId: string | null
  revision: number
  templateId: string
  title: string
}>

/**
 * Sends a document or template to up to ten people to answer. Each gets a
 * link of their own, kept only as its hash, that takes one set of answers
 * within seven days. What they see is frozen as it stood when sent; their
 * answers become a submission and never change the document.
 *
 * @param input - Who sends, what, and to whom.
 * @param deps - Injected client, clock, ids, tokens, email and audit.
 * @returns What became of each person's link, in the order given.
 * @throws PublicFormServiceError 400 for the addresses, 403/404 for access, 409 when it cannot be sent.
 */
export async function sendToAnswer(input: SendToAnswerInput, deps: SendToAnswerDeps = {}): Promise<SentAnswerRequest[]> {
  return run("send_to_answer", input, async () => {
    const parsed = emailsSchema.safeParse(input.emails)

    if (!parsed.success) {
      throw new PublicFormServiceError(parsed.error.issues[0]?.message ?? "Those email addresses are not valid.", 400)
    }

    const client = deps.client ?? createAdminClient()
    const snapshot = await loadSnapshot(client, input)
    const [senderName, organizationName] = await Promise.all([readSenderName(client, input.actorUserId), readOrganizationName(client, input.organizationId)])
    const now = (deps.now ?? (() => new Date()))()
    const requests = parsed.data.map((email) => ({
      email,
      linkId: deps.createId?.() ?? crypto.randomUUID(),
      token: (deps.createToken ?? createSecureToken)(),
    }))
    // Every link is stored before any email goes, so no email carries a link that was never kept.
    const { error } = await client.from("public_form_links").insert(
      requests.map(({ email, linkId, token }) => ({
        answers_snapshot: snapshot.answers,
        content_snapshot: snapshot.content as Record<string, unknown>,
        created_at: now.toISOString(),
        created_by: input.actorUserId,
        document_id: snapshot.documentId,
        expires_at: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
        id: linkId,
        max_submissions: 1,
        org_id: input.organizationId,
        recipient_email: email,
        sent_by: input.actorUserId,
        status: "active",
        submission_count: 0,
        template_id: snapshot.templateId,
        template_revision_snapshot: snapshot.revision,
        title_snapshot: snapshot.title,
        token: null,
        token_hash: hashToken(token),
        updated_at: now.toISOString(),
      }))
    )

    if (error) {
      throw new PublicFormServiceError(FAILED, 500)
    }

    const sent: SentAnswerRequest[] = []

    // One at a time: the email provider limits how fast it takes them.
    for (const { email, linkId, token } of requests) {
      sent.push(await deliver(deps, { linkId, organizationName, recipientEmail: email, senderName, title: snapshot.title, token }))
    }

    await audit(deps, {
      action: snapshot.documentId ? "document.sent_to_answer" : "template.sent_to_answer",
      actorUserId: input.actorUserId,
      metadata: { delivered: sent.filter((request) => request.delivered).length, linkIds: requests.map((request) => request.linkId).join(","), recipients: sent.length },
      organizationId: input.organizationId,
      targetId: snapshot.documentId ?? snapshot.templateId,
      targetType: snapshot.documentId ? "document" : "template",
    })

    return sent
  })
}

/**
 * The address one request went to, for whoever may send it again.
 *
 * @param input - Who asks, and which request.
 * @param deps - Injected client.
 * @returns The recipient's address.
 * @throws PublicFormServiceError 404 when it is not this workspace's, or not visible to them.
 */
export async function readAnswerRequestRecipient(input: RequestInput, deps: Pick<SendToAnswerDeps, "client"> = {}): Promise<string> {
  return run("read_answer_request_recipient", input, async () => (await loadRequest(deps.client ?? createAdminClient(), input)).recipient_email)
}

/**
 * Sends someone a new link to what they were sent, retiring the old one: for
 * an email that never came, or a link that ran out. An answered or revoked
 * request is not sent again.
 *
 * @param input - Who resends, and which request.
 * @param deps - Injected client, clock, tokens, email and audit.
 * @returns What became of the new link.
 * @throws PublicFormServiceError 404 when it is not this workspace's, or not visible to them; 409 once answered or revoked.
 */
export async function resendAnswerRequest(input: RequestInput, deps: SendToAnswerDeps = {}): Promise<SentAnswerRequest> {
  return run("resend_answer_request", input, async () => {
    const client = deps.client ?? createAdminClient()
    const link = await loadRequest(client, input)

    if (link.submission_count > 0 || link.status === "disabled") {
      throw new PublicFormServiceError(link.submission_count > 0 ? "They have already answered it." : "That request was revoked.", 409)
    }

    if (link.document_id) {
      await requireActiveDocument(client, input.organizationId, link.document_id)
    } else if (link.answers_snapshot !== null) {
      // Only a document's send keeps answers; its document has since been purged.
      throw new PublicFormServiceError(INACTIVE, 409)
    }

    const now = (deps.now ?? (() => new Date()))()
    const token = (deps.createToken ?? createSecureToken)()
    const { data: rotated, error } = await client
      .from("public_form_links")
      .update({ expires_at: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(), status: "active", token_hash: hashToken(token), updated_at: now.toISOString() })
      .eq("id", input.linkId)
      .eq("org_id", input.organizationId)
      .eq("submission_count", 0)
      .neq("status", "disabled")
      .select("id")
      .maybeSingle()

    if (error) {
      throw new PublicFormServiceError(FAILED, 500)
    }

    if (!rotated) {
      throw new PublicFormServiceError("That request changed. Reload and try again.", 409)
    }

    const [senderName, organizationName] = await Promise.all([readSenderName(client, input.actorUserId), readOrganizationName(client, input.organizationId)])
    const sent = await deliver(deps, { linkId: input.linkId, organizationName, recipientEmail: link.recipient_email, senderName, title: link.title_snapshot, token })

    await audit(deps, {
      action: "public_form_link.resent",
      actorUserId: input.actorUserId,
      metadata: { delivered: sent.delivered },
      organizationId: input.organizationId,
      targetId: input.linkId,
      targetType: "public_form_link",
    })

    return sent
  })
}

/** Where one request stands, from the sender's side. */
export type AnswerRequestState = "answered" | "expired" | "revoked" | "sent"

export type AnswerRequestSummary = Readonly<{
  email: string
  expiresAt: string | null
  id: string
  sentAt: string
  state: AnswerRequestState
}>

/**
 * Lists whom a document or template was sent to answer, newest first, with
 * where each request stands. Only someone who may send it may see this.
 *
 * @param input - Who asks, and what was sent.
 * @param deps - Injected client and clock.
 * @returns Each person's request.
 * @throws PublicFormServiceError 403/404 for access.
 */
export async function listAnswerRequests(
  input: Who & Readonly<{ source: AnswerSource }>,
  deps: Pick<SendToAnswerDeps, "client" | "now"> = {}
): Promise<AnswerRequestSummary[]> {
  return run("list_answer_requests", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireSender(client, input, input.source)
    const query = client
      .from("public_form_links")
      .select("id,recipient_email,status,submission_count,expires_at,created_at")
      .eq("org_id", input.organizationId)
    const { data, error } = await (input.source.kind === "document"
      ? query.eq("document_id", input.source.documentId)
      : query.eq("template_id", input.source.templateId).is("document_id", null)
    ).order("created_at", { ascending: false })

    if (error) {
      throw new PublicFormServiceError("Unable to load what was sent.", 500)
    }

    const now = (deps.now ?? (() => new Date()))().getTime()
    const rows = (data ?? []) as { created_at: string; expires_at: string | null; id: string; recipient_email: string | null; status: string; submission_count: number }[]

    // Links open to anyone have no recipient; they are listed with the template's public links.
    return rows.flatMap((row) =>
      row.recipient_email
        ? [
            {
              email: row.recipient_email,
              expiresAt: row.expires_at,
              id: row.id,
              sentAt: row.created_at,
              state:
                row.submission_count > 0
                  ? "answered"
                  : row.status === "disabled"
                    ? "revoked"
                    : row.expires_at && Date.parse(row.expires_at) <= now
                      ? "expired"
                      : "sent",
            },
          ]
        : []
    )
  })
}

/**
 * Stops a request's link from taking answers. An answered request is already
 * closed, so it is refused rather than rewritten.
 *
 * @param input - Who revokes, and which request.
 * @param deps - Injected client, clock and audit.
 * @throws PublicFormServiceError 404 when it is not this workspace's; 409 once answered.
 */
export async function revokeAnswerRequest(input: RequestInput, deps: SendToAnswerDeps = {}): Promise<void> {
  return run("revoke_answer_request", input, async () => {
    const client = deps.client ?? createAdminClient()
    await loadRequest(client, input)
    const { data, error } = await client
      .from("public_form_links")
      .update({ status: "disabled", updated_at: (deps.now ?? (() => new Date()))().toISOString() })
      .eq("id", input.linkId)
      .eq("org_id", input.organizationId)
      .eq("submission_count", 0)
      .select("id")
      .maybeSingle()

    if (error) {
      throw new PublicFormServiceError(FAILED, 500)
    }

    if (!data) {
      throw new PublicFormServiceError("They have already answered it.", 409)
    }

    await audit(deps, {
      action: "public_form_link.revoked",
      actorUserId: input.actorUserId,
      metadata: {},
      organizationId: input.organizationId,
      targetId: input.linkId,
      targetType: "public_form_link",
    })
  })
}

// One person's request, once whoever asks has shown they may send it now.
async function loadRequest(
  client: Client,
  input: RequestInput
): Promise<{ answers_snapshot: unknown; document_id: string | null; recipient_email: string; status: string; submission_count: number; template_id: string; title_snapshot: string }> {
  const { data, error } = await client
    .from("public_form_links")
    .select("id,org_id,template_id,document_id,answers_snapshot,recipient_email,status,submission_count,title_snapshot")
    .eq("id", input.linkId)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) {
    throw new PublicFormServiceError(FAILED, 500)
  }

  const link = data as { answers_snapshot: unknown; document_id: string | null; recipient_email: string | null; status: string; submission_count: number; template_id: string; title_snapshot: string | null } | null

  if (!link?.recipient_email || !link.title_snapshot) {
    throw new PublicFormServiceError("That request was not found.", 404)
  }

  await requireSender(client, input, link.document_id ? { documentId: link.document_id, kind: "document" } : { kind: "template", templateId: link.template_id })

  return { ...link, recipient_email: link.recipient_email, title_snapshot: link.title_snapshot }
}

async function loadSnapshot(client: Client, input: SendToAnswerInput): Promise<Snapshot> {
  await requireSender(client, input, input.source)

  if (input.source.kind === "template") {
    const { data } = await client
      .from("published_document_templates")
      .select("id,title,revision,content")
      .eq("id", input.source.templateId)
      .eq("org_id", input.organizationId)
      .maybeSingle()
    const template = data as { content: unknown; id: string; revision: number; title: string } | null

    if (!template) {
      throw new PublicFormServiceError("Publish the template before sending it to answer.", 409)
    }

    return { answers: null, content: template.content, documentId: null, revision: template.revision, templateId: template.id, title: template.title }
  }

  const view = await loadGeneratedDocumentView(client as never, input.organizationId, input.source.documentId)
  const document = view.document

  if (document.lifecycleState !== "active") {
    throw new PublicFormServiceError(INACTIVE, 409)
  }

  // Answers are kept as submissions of a template, so a document needs one.
  if (!document.templateId || document.templateRevision === null) {
    throw new PublicFormServiceError("Only a document made from a template can be sent to answer for now.", 409)
  }

  return {
    answers: view.answers,
    content: document.templateSnapshot,
    documentId: document.id,
    revision: document.templateRevision,
    templateId: document.templateId,
    title: document.title,
  }
}

// Who may send: whoever may edit a template, as for its public links; for a
// document, a member who may change it and send documents. Never a guest.
async function requireSender(
  client: Client,
  input: Readonly<{ actorUserId: string; organizationId: string }>,
  source: AnswerSource
): Promise<void> {
  try {
    if (source.kind === "template") {
      await requireTemplateAccess(client as never, { actorUserId: input.actorUserId, organizationId: input.organizationId, templateId: source.templateId }, "editor", "You cannot send this template.")
      return
    }

    await requireDocumentAccess(
      {
        actorUserId: input.actorUserId,
        documentId: source.documentId,
        operation: "mutation",
        organizationId: input.organizationId,
        requiredAccess: "contributor",
        requiredOrganizationPermissionAction: "documents:send",
      },
      client as never
    )
  } catch (error: unknown) {
    if (error instanceof DocumentServiceError || error instanceof TemplateServiceError) {
      throw new PublicFormServiceError(error.statusCode === 403 ? "You cannot send this to answer." : error.message, error.statusCode)
    }

    throw error
  }
}

async function deliver(deps: SendToAnswerDeps, request: AnswerRequest): Promise<SentAnswerRequest> {
  try {
    await (deps.sendRequest ?? sendAnswerRequestEmail)(request)
    return { delivered: true, email: request.recipientEmail, linkId: request.linkId, token: null }
  } catch (error: unknown) {
    console.warn("answer_request_email_failed", { linkId: request.linkId, reason: error instanceof Error ? error.message : "Unknown email error" })
    return { delivered: false, email: request.recipientEmail, linkId: request.linkId, token: request.token }
  }
}

async function audit(deps: SendToAnswerDeps, input: RecordAuditLogInput): Promise<void> {
  await recordAuditLogBestEffort(input, deps.recordAuditLog)
}

const INACTIVE = "Only an active document can be sent to answer."

// An archived document, or one in the trash, is not sent out again.
async function requireActiveDocument(client: Client, organizationId: string, documentId: string): Promise<void> {
  const { data, error } = await client.from("documents").select("lifecycle_state").eq("id", documentId).eq("org_id", organizationId).maybeSingle()

  if (error) {
    throw new PublicFormServiceError(FAILED, 500)
  }

  if ((data as { lifecycle_state?: string } | null)?.lifecycle_state !== "active") {
    throw new PublicFormServiceError(INACTIVE, 409)
  }
}

function run<T>(operationName: string, input: Who, operation: () => Promise<T>): Promise<T> {
  return runOperation("send_to_answer", toSendToAnswerError, operationName, { actorUserId: input.actorUserId, organizationId: input.organizationId }, operation)
}

function toSendToAnswerError(error: unknown): PublicFormServiceError {
  if (error instanceof PublicFormServiceError) return error
  if (error instanceof DocumentSigningServiceError && error.statusCode < 500) return new PublicFormServiceError(error.message, error.statusCode)
  return new PublicFormServiceError(FAILED, 500)
}

async function readSenderName(client: Client, userId: string): Promise<string> {
  const { data, error } = await client.from("profiles").select("full_name,email").eq("id", userId).maybeSingle()

  if (error) {
    throw new PublicFormServiceError(FAILED, 500)
  }

  const profile = data as { email?: string | null; full_name?: string | null } | null
  return profile?.full_name?.trim() || profile?.email || "Someone"
}

async function readOrganizationName(client: Client, organizationId: string): Promise<string> {
  const { data, error } = await client.from("organizations").select("name").eq("id", organizationId).maybeSingle()

  if (error) {
    throw new PublicFormServiceError(FAILED, 500)
  }

  return (data as { name?: string } | null)?.name ?? "BizFlow"
}
