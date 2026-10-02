import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase/admin"
import { assertSecureToken, hashToken } from "@/services/document-signing/token-security"
import { recordRequiredDocumentAuditLog } from "@/services/documents/audit"
import type { DocumentServiceClient, DocumentServiceDeps } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import { createSupabaseServiceError, getClient, runDocumentOperation } from "@/services/documents/shared"

type GuestDeps = DocumentServiceDeps & { now?: () => Date }
type GuestLevel = "contributor" | "viewer"

/** The one document someone outside its workspace was given, as they may see it. */
export type GuestDocument = {
  accessLevel: GuestLevel
  organizationId: string
  organizationName: string
  sourceKind: "generated" | "upload"
  title: string
}

/** What an invite link shows before it is accepted. */
export type GuestInvite = { documentTitle: string; email: string; organizationName: string }

const GONE = "This link has expired or was already used. Ask for a new one."
// Trash and pending purge hide a document from everyone; archived stays readable.
const READABLE_STATES = new Set(["active", "archived"])

/**
 * The level a joined guest holds on one document, or null when they hold none.
 *
 * @param client - Trusted database client.
 * @param input - The document, its workspace, and the person.
 * @returns Their level, or null.
 */
export async function findGuestGrant(
  client: DocumentServiceClient,
  input: { documentId: string; organizationId?: string; userId: string }
): Promise<{ accessLevel: GuestLevel; organizationId: string } | null> {
  let query = client
    .from("document_guest_grants")
    .select("org_id,access_level")
    .eq("document_id", input.documentId)
    .eq("user_id", input.userId)

  if (input.organizationId) query = query.eq("org_id", input.organizationId)

  const { data, error } = await query.maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to load document access.")

  return data ? { accessLevel: data.access_level as GuestLevel, organizationId: data.org_id } : null
}

/**
 * The workspace a guest's document lives in, so their requests act there
 * rather than in a workspace of their own.
 *
 * @param input - The document and the signed-in person.
 * @param deps - Optional database client for tests.
 * @returns The document's workspace, or null when they are not its guest.
 */
export async function findGuestOrganizationId(
  input: { documentId: string; userId: string },
  deps: GuestDeps = {}
): Promise<string | null> {
  return (await findGuestGrant(getClient(deps), input))?.organizationId ?? null
}

/**
 * The document a person outside its workspace was given, while they still
 * have it and it is not in the trash.
 *
 * @param input - The document and the signed-in person.
 * @param deps - Optional database client for tests.
 * @returns The document as a guest sees it, or null when they are not its guest.
 */
export async function findGuestDocument(
  input: { documentId: string; userId: string },
  deps: GuestDeps = {}
): Promise<GuestDocument | null> {
  return runDocumentOperation("find_guest_document", { documentId: input.documentId, userId: input.userId }, async () => {
    const client = getClient(deps)
    const grant = await findGuestGrant(client, input)

    if (!grant) return null

    const document = await readDocument(client, grant.organizationId, input.documentId)

    if (!document || !READABLE_STATES.has(document.lifecycle_state)) return null

    return {
      accessLevel: grant.accessLevel,
      organizationId: grant.organizationId,
      organizationName: await readOrganizationName(client, grant.organizationId),
      sourceKind: document.source_kind,
      title: document.title,
    }
  })
}

/**
 * What an emailed link is for, before anyone signs in.
 *
 * @param token - The link's secret.
 * @param deps - Optional database client and clock for tests.
 * @returns The invited address, the document, and who shared it.
 * @throws DocumentServiceError 404 for a link that is unknown or used, 410 once expired.
 */
export async function getGuestInvite(token: string, deps: GuestDeps = {}): Promise<GuestInvite> {
  return runDocumentOperation("get_guest_invite", { tokenLength: token.length }, async () => {
    const client = getClient(deps)
    const { document, invite } = await loadPendingInvite(client, token, deps)

    return {
      documentTitle: document.title,
      email: invite.email,
      organizationName: await readOrganizationName(client, invite.org_id),
    }
  })
}

/**
 * Accepts an emailed link as the person it was sent to. The link then stops
 * working, and the document stays open to their account until access is removed.
 *
 * @param input - The link's secret and who is signed in.
 * @param deps - Optional database client, clock, and audit recorder for tests.
 * @returns The document now open to them.
 * @throws DocumentServiceError 403 for another address, 404 for a used or unknown link, 410 once expired.
 */
export async function acceptDocumentGuestInvite(
  input: { token: string; userEmail: string | null; userId: string },
  deps: GuestDeps = {}
): Promise<{ documentId: string }> {
  return runDocumentOperation("accept_document_guest_invite", { userId: input.userId }, async () => {
    const client = getClient(deps)
    const { invite, tokenHash } = await loadPendingInvite(client, input.token, deps)

    if ((input.userEmail ?? "").trim().toLowerCase() !== invite.email) {
      throw new DocumentServiceError(`This link was sent to ${invite.email}. Sign in with that address to open it.`, 403)
    }

    // Only joining a workspace makes a profile, and a guest never joins one.
    const { error: profileError } = await client.from("profiles").insert({ email: invite.email, id: input.userId })

    if (profileError && profileError.code !== "23505") {
      throw createSupabaseServiceError(profileError, "Unable to open the document.")
    }

    // Matching the hash again makes a second, simultaneous accept find nothing.
    const { data, error } = await client
      .from("document_guest_grants")
      .update({
        accepted_at: now(deps).toISOString(),
        invite_expires_at: null,
        invite_token_hash: null,
        user_id: input.userId,
      })
      .eq("id", invite.id)
      .eq("invite_token_hash", tokenHash)
      .select("id")
      .maybeSingle()

    if (error) throw createSupabaseServiceError(error, "Unable to open the document.")
    if (!data) throw new DocumentServiceError(GONE, 404)

    await recordRequiredDocumentAuditLog(deps, {
      action: "document.guest_joined",
      actorUserId: input.userId,
      metadata: { accessLevel: invite.access_level, email: invite.email, grantId: invite.id },
      organizationId: invite.org_id,
      targetId: invite.document_id,
      targetType: "document",
    })

    return { documentId: invite.document_id }
  })
}

/**
 * Opens an account for the address a document link was sent to: always the
 * link's own address, never one typed in. Email confirmation is skipped
 * because holding the emailed link already proves the inbox.
 *
 * @param input - The link's secret and the password they chose.
 * @param deps - Optional database client and clock for tests.
 * @returns The invited address, and whether an account already used it.
 * @throws DocumentServiceError 404/410 for a link that no longer works, 400 for a refused password.
 */
export async function createGuestAccount(
  input: { password: string; token: string },
  deps: Omit<GuestDeps, "client"> & { client?: AdminSupabaseClient } = {}
): Promise<{ email: string; existing: boolean }> {
  return runDocumentOperation("create_guest_account", { tokenLength: input.token.length }, async () => {
    const client = deps.client ?? createAdminClient()
    const { invite } = await loadPendingInvite(client, input.token, deps)
    const { error } = await client.auth.admin.createUser({ email: invite.email, email_confirm: true, password: input.password })

    if (error?.code === "email_exists") return { email: invite.email, existing: true }
    if (error?.code === "weak_password") throw new DocumentServiceError("Choose a longer or less common password.", 400)
    if (error) throw new DocumentServiceError("Unable to create your account.", 500)

    return { email: invite.email, existing: false }
  })
}

async function loadPendingInvite(client: DocumentServiceClient, token: string, deps: GuestDeps) {
  try {
    assertSecureToken(token)
  } catch {
    throw new DocumentServiceError(GONE, 404)
  }

  const tokenHash = hashToken(token)
  const { data: invite, error } = await client
    .from("document_guest_grants")
    .select("id,org_id,document_id,email,access_level,invite_expires_at")
    .eq("invite_token_hash", tokenHash)
    .maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to read the link.")
  if (!invite?.invite_expires_at) throw new DocumentServiceError(GONE, 404)
  if (new Date(invite.invite_expires_at).getTime() <= now(deps).getTime()) {
    throw new DocumentServiceError("This link has expired. Ask for a new one.", 410)
  }

  // A document in the trash looks exactly like a link that never worked.
  const document = await readDocument(client, invite.org_id, invite.document_id)

  if (!document || !READABLE_STATES.has(document.lifecycle_state)) throw new DocumentServiceError(GONE, 404)

  return { document, invite, tokenHash }
}

async function readDocument(client: DocumentServiceClient, organizationId: string, documentId: string) {
  const { data, error } = await client
    .from("documents")
    .select("title,source_kind,lifecycle_state")
    .eq("id", documentId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to load the document.")

  return data
}

/**
 * The workspace's name, as shown to someone outside it.
 *
 * @param client - Trusted database client.
 * @param organizationId - The workspace.
 * @returns Its name, or a neutral stand-in.
 */
export async function readOrganizationName(client: DocumentServiceClient, organizationId: string): Promise<string> {
  const { data, error } = await client.from("organizations").select("name").eq("id", organizationId).maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to read the workspace.")

  return data?.name ?? "A BizFlow workspace"
}

const now = (deps: GuestDeps): Date => deps.now?.() ?? new Date()
