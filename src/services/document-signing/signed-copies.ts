import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import { recordAuditLogBestEffort } from "@/services/audit-service"
import {
  sendSignedCopyEmail as defaultSendSignedCopyEmail,
  type SendSignedCopyEmailInput,
} from "@/services/document-signing-email-service"
import type { DocumentSigningServiceDeps, SigningServiceClient } from "@/services/document-signing/contracts"
import { createDatabaseError, DocumentSigningServiceError, runSigningOperation } from "@/services/document-signing/errors"
import { loadRecipientByToken, resolveSigningClient } from "@/services/document-signing/persistence"
import {
  assertRecipientLinkUsable,
  createSecureToken,
  getSigningNow,
  hashToken,
  normalizeToken,
} from "@/services/document-signing/token-security"
import { createSignedDocumentDownloadUrl as defaultCreateSignedDocumentDownloadUrl } from "@/services/document-storage-service"
import { createSupabaseFinalizationPersistence } from "@/services/generated-document-finalization/persistence"

/** The finished paper's stored object, once the document is finalized. */
type FinalizedVersion = { originalFilename: string; storageKey: string }

export type SignedCopyDeps = Pick<DocumentSigningServiceDeps, "client" | "createToken" | "now" | "recordAuditLog"> & {
  sendSignedCopyEmail?: (input: SendSignedCopyEmailInput) => Promise<void>
  findFinalizedVersion?: (organizationId: string, documentId: string) => Promise<FinalizedVersion | null>
  createSignedDocumentDownloadUrl?: (input: { downloadFilename: string; storageKey: string }) => Promise<{ downloadUrl: string }>
}

/**
 * Emails every signer, and whoever sent it, a link to the finished paper.
 * Runs once per document: a document whose links exist already is left alone.
 * An email that fails is logged and the rest still go.
 *
 * @param document - The finalized document.
 * @param deps - Optional clock, token, database and email dependencies for tests.
 * @returns How many addresses were sent a link.
 */
export async function sendSignedCopies(
  document: { organizationId: string; documentId: string },
  deps: SignedCopyDeps = {}
): Promise<number> {
  return runSigningOperation("send_signed_copies", document, async () => {
    const client = resolveSigningClient(deps.client)
    const { documentId, organizationId } = document
    const [existing, recipients, source, organization] = await Promise.all([
      client.from("document_signed_copy_links").select("id").eq("org_id", organizationId).eq("document_id", documentId),
      client
        .from("document_signing_recipients")
        .select("email,sent_by")
        .eq("org_id", organizationId)
        .eq("document_id", documentId)
        .is("revoked_at", null),
      client.from("documents").select("title,created_by").eq("org_id", organizationId).eq("id", documentId).maybeSingle(),
      client.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    ])

    if (existing.error || recipients.error || source.error || organization.error || !source.data || !organization.data) {
      throw createDatabaseError(existing.error ?? recipients.error ?? source.error ?? organization.error, "Unable to load the signed document.")
    }

    // ponytail: two finalizers racing can both get here; a second email is the worst of it.
    if ((existing.data ?? []).length > 0) {
      return 0
    }

    const rows = (recipients.data ?? []) as Array<{ email: string; sent_by: string | null }>
    const { created_by: createdBy, title } = source.data as { created_by: string | null; title: string }
    const senderEmail = await loadProfileEmail(client, rows.find((row) => row.sent_by)?.sent_by ?? createdBy)
    const emails = [...new Set([...rows.map((row) => row.email), ...(senderEmail ? [senderEmail] : [])].map((email) => email.trim().toLowerCase()))]
    const createToken = deps.createToken ?? createSecureToken
    const links = emails.map((email) => ({ email, token: createToken() }))
    const expiresAt = new Date(getSigningNow(deps.now).getTime() + COPY_LINK_LIFETIME_MS).toISOString()

    const inserted = await client.from("document_signed_copy_links").insert(
      links.map(({ email, token }) => ({ org_id: organizationId, document_id: documentId, email, token_hash: hashToken(token), expires_at: expiresAt }))
    )

    if (inserted.error) {
      throw createDatabaseError(inserted.error, "Unable to create signed copy links.")
    }

    const send = deps.sendSignedCopyEmail ?? defaultSendSignedCopyEmail
    const organizationName = (organization.data as { name: string }).name
    const deliveries = await Promise.allSettled(
      links.map(({ email, token }) => send({ documentId, documentTitle: title, organizationName, recipientEmail: email, token }))
    )
    const failedDeliveries = deliveries.filter((delivery) => delivery.status === "rejected").length

    if (failedDeliveries > 0) {
      console.warn("document_signed_copy_email_incomplete", { organizationId, documentId, failedDeliveries })
    }

    return links.length
  })
}

/**
 * Opens a completed document's signed copy through the link emailed with it,
 * or through a signer's own signing link while that still works.
 *
 * @param input - Either link's token.
 * @param deps - Optional clock, database, storage and audit dependencies for tests.
 * @returns A short-lived download URL for the finished paper.
 * @throws DocumentSigningServiceError: 404 unknown, 410 expired, 409 not ready.
 */
export async function openSignedCopy(input: { token: string }, deps: SignedCopyDeps = {}): Promise<{ downloadUrl: string }> {
  return runSigningOperation("open_signed_copy", {}, async () => {
    const client = resolveSigningClient(deps.client)
    const tokenHash = hashToken(normalizeToken(input.token))
    const now = getSigningNow(deps.now)
    // tenant-scope: the link holds only the token; its hash finds the one row, whose org_id then scopes every later read
    const copy = await client.from("document_signed_copy_links").select("org_id,document_id,expires_at").eq("token_hash", tokenHash).maybeSingle()

    if (copy.error) {
      throw createDatabaseError(copy.error, "Unable to open the signed copy.")
    }

    const link = copy.data as { document_id: string; expires_at: string; org_id: string } | null
    let organizationId: string
    let documentId: string

    if (link) {
      if (new Date(link.expires_at).getTime() <= now.getTime()) {
        throw new DocumentSigningServiceError("This link to the signed copy has expired. Ask the sender for the document.", 410)
      }
      ;({ document_id: documentId, org_id: organizationId } = link)
    } else {
      const recipient = await loadRecipientByToken(client, tokenHash)
      assertRecipientLinkUsable(recipient, now)
      ;({ document_id: documentId, org_id: organizationId } = recipient)
      await requireCompleted(client, organizationId, documentId)
    }

    // tenant-scope: org_id comes from the link's own row
    const source = await client.from("documents").select("lifecycle_state").eq("org_id", organizationId).eq("id", documentId).maybeSingle()
    const lifecycle = (source.data as { lifecycle_state?: string } | null)?.lifecycle_state

    if (lifecycle !== "active" && lifecycle !== "archived") {
      throw new DocumentSigningServiceError("This document is no longer available.", 404)
    }

    const findFinalizedVersion = deps.findFinalizedVersion ?? ((org: string, doc: string) => findFinalizedVersionInDatabase(client, org, doc))
    const version = await findFinalizedVersion(organizationId, documentId)

    if (!version) {
      throw new DocumentSigningServiceError("The signed copy is still being prepared. Try again in a minute.", 409)
    }

    const createUrl = deps.createSignedDocumentDownloadUrl ?? defaultCreateSignedDocumentDownloadUrl
    const { downloadUrl } = await createUrl({ downloadFilename: version.originalFilename, storageKey: version.storageKey })

    await recordAuditLogBestEffort(
      {
        organizationId,
        actorUserId: null,
        action: "document_version.download_url_issued",
        targetType: "document",
        targetId: documentId,
        metadata: { documentId, via: link ? "signed_copy_link" : "signing_link" },
      },
      deps.recordAuditLog
    )

    return { downloadUrl }
  })
}

const COPY_LINK_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000

async function requireCompleted(client: SigningServiceClient, organizationId: string, documentId: string): Promise<void> {
  const { data, error } = await client
    .from("document_answers")
    .select("workflow_status")
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to open the signed copy.")
  }

  if ((data as { workflow_status?: string } | null)?.workflow_status !== "completed") {
    throw new DocumentSigningServiceError("There is no signed copy until everyone has signed.", 409)
  }
}

async function findFinalizedVersionInDatabase(
  client: SigningServiceClient,
  organizationId: string,
  documentId: string
): Promise<FinalizedVersion | null> {
  const finalization = await createSupabaseFinalizationPersistence(client as AdminSupabaseClient).findByDocument(organizationId, documentId)

  if (finalization?.status !== "finalized" || !finalization.documentVersionId) {
    return null
  }

  const { data, error } = await client
    .from("document_versions")
    .select("storage_key,original_filename,status")
    .eq("org_id", organizationId)
    .eq("document_id", documentId)
    .eq("id", finalization.documentVersionId)
    .maybeSingle()

  if (error) {
    throw createDatabaseError(error, "Unable to open the signed copy.")
  }

  const version = data as { original_filename: string; status: string; storage_key: string } | null
  return version?.status === "available" ? { originalFilename: version.original_filename, storageKey: version.storage_key } : null
}

// tenant-scope: profiles are global; the id comes from this document's own rows
export async function loadProfileEmail(client: SigningServiceClient, userId: string | null): Promise<string | null> {
  if (!userId) {
    return null
  }

  const { data } = await client.from("profiles").select("email").eq("id", userId).maybeSingle()
  return (data as { email?: string | null } | null)?.email ?? null
}
