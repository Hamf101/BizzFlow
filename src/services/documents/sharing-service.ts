import { z } from "zod"

import { canPerformOrganizationAction, isOrganizationRole, type OrganizationRole } from "@/lib/permissions"
import { createSecureToken, hashToken, TOKEN_LIFETIME_MS } from "@/services/document-signing/token-security"
import { getEffectiveDocumentAccess, getEffectiveFolderAccess } from "@/services/documents/access-service"
import { recordDocumentAuditLog } from "@/services/documents/audit"
import type { DocumentServiceClient } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import { sendGuestInviteEmail } from "@/services/documents/guest-invite-email"
import { readOrganizationName } from "@/services/documents/guest-service"
import { broadcastSharingNotice } from "@/services/documents/sharing-notice"
import { everyoneWho } from "@/services/documents/sharing-words"
import type {
  SetSharingAccessInput,
  SetSharingInheritanceInput,
  SharingGrant,
  SharingGuest,
  SharingInherited,
  SharingInput,
  SharingLevel,
  SharingPerson,
  SharingPrincipal,
  SharingResource,
  SharingServiceDeps,
  SharingView,
} from "@/services/documents/sharing-contracts"
import {
  createId,
  createSupabaseServiceError,
  getActiveMembership,
  getClient,
  runDocumentOperation,
} from "@/services/documents/shared"
import { listOrganizationPeople } from "@/services/organizations/membership-service"
import type { AuditLogAction } from "@/types/audit"
import type { OrganizationMember } from "@/types/organization"

// One implementation serves both: only the tables and column names differ.
const KINDS = {
  document: {
    audit: {
      granted: "document.access_granted",
      inheritance: "document.sharing_inheritance_changed",
      revoked: "document.access_revoked",
    },
    grantColumn: "document_id",
    grants: "document_access_grants",
    label: "Document",
    levels: ["viewer", "contributor"],
    nameColumn: "title",
    parentColumn: "folder_id",
    table: "documents",
  },
  folder: {
    audit: {
      granted: "folder.access_granted",
      inheritance: "folder.sharing_inheritance_changed",
      revoked: "folder.access_revoked",
    },
    grantColumn: "folder_id",
    grants: "folder_access_grants",
    label: "Folder",
    levels: ["viewer", "contributor"],
    nameColumn: "name",
    parentColumn: "parent_folder_id",
    table: "folders",
  },
  // A template has no folder. "Inherit" is the reverse of its restricted flag:
  // it starts open to everyone, and the maker can keep it to chosen people.
  template: {
    audit: {
      granted: "template.access_granted",
      inheritance: "template.sharing_restriction_changed",
      revoked: "template.access_revoked",
    },
    grantColumn: "template_id",
    grants: "template_access_grants",
    label: "Template",
    levels: ["viewer", "user", "editor"],
    nameColumn: "title",
    parentColumn: null,
    table: "document_templates",
  },
} as const satisfies Record<SharingResource["kind"], { audit: Record<string, AuditLogAction> } & Record<string, unknown>>

const MAX_FOLDER_DEPTH = 50
// Roles a share can name. Owner admins always have access and are never granted it.
const SHAREABLE_ROLES: readonly OrganizationRole[] = ["manager", "staff", "external_reviewer"]

type Target = {
  /** The actor's own role, and their level here; null when nothing limits them (its maker, an owner admin). */
  actor: { level: SharingLevel | null; role: OrganizationRole }
  createdBy: string | null
  inherit: boolean
  name: string
  parentId: string | null
  /** A document's: made here ("generated") or uploaded. */
  sourceKind: string | null
}

type Row = Record<string, unknown>
type MemberPrincipal = Exclude<SharingPrincipal, { email: string }>

// The database is typed per table; these two names are chosen at run time.
type AnyTable = "documents"
type AnyGrants = "document_access_grants"

// Templates say "restricted" where documents say "inherit"; this reads and writes whichever the kind uses.
const restrictsInsteadOfInherits = (resource: SharingResource): boolean => resource.kind === "template"

/**
 * Shows everything the Share dialog needs for a document or a folder: who made
 * it, who it was shared with, what it takes in from the folders above, and
 * everyone who could be added.
 *
 * @param input - Actor, organization and the item.
 * @param deps - Injected client, people lookup and audit for tests.
 * @returns The sharing of the item.
 * @throws DocumentServiceError 404 when the actor cannot open it, 403 when they may not change its sharing.
 */
export async function getSharing(input: SharingInput, deps: SharingServiceDeps = {}): Promise<SharingView> {
  return runDocumentOperation("get_sharing", identifiers(input), async () => {
    const client = getClient(deps)
    const target = await authorize(client, input)

    return buildView(client, input, target, deps)
  })
}

/** A sharing change that has been checked and not yet made. */
export type PreparedSharingChange = {
  apply: () => Promise<void>
  view: () => Promise<SharingView>
}

/**
 * Checks a share, a level change or a removal without making it, so a whole
 * selection can be checked before any of it changes.
 *
 * @param input - Actor, organization, item, who, and what level.
 * @param deps - Injected client, ids, people lookup, notice and audit.
 * @returns The change, ready to make, and the item's sharing to read afterwards.
 * @throws DocumentServiceError when the actor may not share it or the choice is not allowed.
 */
export async function prepareSharingAccess(
  input: SetSharingAccessInput,
  deps: SharingServiceDeps = {}
): Promise<PreparedSharingChange> {
  const client = getClient(deps)
  const target = await authorize(client, input, true)
  const kind = KINDS[input.resource.kind]
  const people = await listMembers(deps, input)
  const view = (): Promise<SharingView> => buildView(client, input, target, deps)

  if ("email" in input.principal) {
    const email = guestEmail(input.principal.email)
    const member = people.find((person) => person.status === "active" && person.email.toLowerCase() === email)

    // Someone already in the workspace is shared with as a member.
    if (!member) {
      const guest = { ...input, principal: { email } }

      checkGuest(guest, target)

      return { apply: () => shareWithGuest(client, guest, target, people, deps), view }
    }

    input = { ...input, principal: { userId: member.userId } }
  }

  const who = checkPrincipal(input, target, people)
  // An email was turned into a member above, or went to the guest path.
  const principal = input.principal as MemberPrincipal
  const { level } = input

  // Managing folders lets someone change who an item is shared with, not give themselves more than they have.
  const self = "userId" in principal ? principal.userId === input.actorUserId : principal.role === target.actor.role
  const levels: readonly SharingLevel[] = kind.levels

  if (self && level !== null && target.actor.level !== null && levels.indexOf(level) > levels.indexOf(target.actor.level)) {
    throw new DocumentServiceError("You cannot give yourself more access than you have.", 403)
  }

  const apply = async (): Promise<void> => {
    const where = { [kind.grantColumn]: input.resource.id, org_id: input.organizationId }
    const existing = await findGrant(client, kind.grants, where, principal)
    const grants = client.from(kind.grants as AnyGrants)

    if (level === null) {
      if (existing) {
        const { error } = await grants.delete().eq("id", existing.id as string).eq("org_id", input.organizationId)

        if (error) throw createSupabaseServiceError(error, "Unable to take that access away.")
      }
    } else if (existing) {
      const { error } = await grants
        .update({ access_level: level, granted_by: input.actorUserId } as Row)
        .eq("id", existing.id as string)
        .eq("org_id", input.organizationId)

      if (error) throw createSupabaseServiceError(error, "Unable to change that access.")
    } else {
      const { error } = await grants.insert({
        ...where,
        access_level: level,
        granted_by: input.actorUserId,
        id: createId(deps),
        organization_role: "role" in principal ? principal.role : null,
        user_id: "userId" in principal ? principal.userId : null,
      } as never)

      if (error) throw createSupabaseServiceError(error, "Unable to share that.", error.code === "23505" ? 409 : 500)
    }

    // Best effort: the share is already made, so a lost record must not report it as failed.
    await recordDocumentAuditLog(deps, {
      action: level === null ? kind.audit.revoked : kind.audit.granted,
      actorUserId: input.actorUserId,
      metadata: { level, principal: who.label, principalKind: "role" in principal ? "role" : "person" },
      organizationId: input.organizationId,
      targetId: input.resource.id,
      targetType: input.resource.kind,
    })

    if (level !== null && !existing && "userId" in principal && principal.userId !== input.actorUserId) {
      await tell(deps, {
        actorName: nameOf(people.find((person) => person.userId === input.actorUserId)) ?? "Someone",
        level,
        recipientUserId: principal.userId,
        resource: input.resource,
        resourceName: target.name,
      })
    }
  }

  return { apply, view }
}

/**
 * Checks a change to whether an item takes in its folders' sharing without making it.
 *
 * @param input - Actor, organization, item, and the choice.
 * @param deps - Injected client, people lookup and audit.
 * @returns The change, ready to make, and the item's sharing to read afterwards.
 * @throws DocumentServiceError when the actor may not change its sharing.
 */
export async function prepareSharingInheritance(
  input: SetSharingInheritanceInput,
  deps: SharingServiceDeps = {}
): Promise<PreparedSharingChange> {
  const client = getClient(deps)
  const target = await authorize(client, input, true)
  const kind = KINDS[input.resource.kind]

  return {
    apply: async () => {
      const { error } = await client
        .from(kind.table as AnyTable)
        .update((restrictsInsteadOfInherits(input.resource) ? { access_restricted: !input.inherit } : { share_inherit: input.inherit }) as Row)
        .eq("id", input.resource.id)
        .eq("org_id", input.organizationId)

      if (error) throw createSupabaseServiceError(error, "Unable to change that.")

      // Best effort, as for a share: the change is already made.
      await recordDocumentAuditLog(deps, {
        action: kind.audit.inheritance,
        actorUserId: input.actorUserId,
        metadata: restrictsInsteadOfInherits(input.resource) ? { restricted: !input.inherit } : { inherit: input.inherit },
        organizationId: input.organizationId,
        targetId: input.resource.id,
        targetType: input.resource.kind,
      })
    },
    view: () => buildView(client, input, { ...target, inherit: input.inherit }, deps),
  }
}

function identifiers(input: SharingInput): Record<string, string> {
  return {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    resourceId: input.resource.id,
    resourceKind: input.resource.kind,
  }
}

// Who may change the sharing: the person who made it, and anyone who manages
// folders (owner admins and managers), provided they can open it. Anyone who
// cannot open it is told it does not exist. Only an active document's sharing
// changes: one archived or in the trash is not passed on.
async function authorize(client: DocumentServiceClient, input: SharingInput, change = false): Promise<Target> {
  const kind = KINDS[input.resource.kind]
  const notFound = new DocumentServiceError(`${kind.label} was not found.`, 404)
  const membership = await getActiveMembership(client, input.organizationId, input.actorUserId)

  if (!membership) throw notFound

  const { data, error } = await client
    .from(kind.table as AnyTable)
    .select(
      [
        "id",
        "created_by",
        restrictsInsteadOfInherits(input.resource) ? "access_restricted" : "share_inherit",
        kind.nameColumn,
        kind.parentColumn,
        input.resource.kind === "document" ? "source_kind" : null,
        input.resource.kind === "document" ? "lifecycle_state" : null,
      ]
        .filter(Boolean)
        .join(",") as "id" // the columns differ by kind, so the database's typing cannot follow them
    )
    .eq("id", input.resource.id)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) throw createSupabaseServiceError(error, `Unable to load that ${kind.label.toLowerCase()}.`)

  if (!data) throw notFound

  const row = data as unknown as Row
  const target: Target = {
    actor: { level: null, role: membership.role },
    createdBy: (row.created_by as string | null) ?? null,
    inherit: restrictsInsteadOfInherits(input.resource) ? row.access_restricted !== true : row.share_inherit !== false,
    name: String(row[kind.nameColumn]),
    parentId: kind.parentColumn ? ((row[kind.parentColumn] as string | null) ?? null) : null,
    sourceKind: (row.source_kind as string | undefined) ?? null,
  }
  const made = target.createdBy === input.actorUserId
  // Templates go by their own level: editing one is what allows sharing it.
  const canManage = input.resource.kind !== "template" && canPerformOrganizationAction(membership, "folders:manage")

  if (!made && membership.role !== "owner_admin") {
    const access = await accessTo(client, input)

    if (access === null) throw notFound

    target.actor.level = access

    // Whoever can edit it may pass it on; someone who can only view it may not, unless they manage folders.
    if (access !== "contributor" && access !== "editor" && !canManage) {
      throw new DocumentServiceError("Only someone who can edit this, or a manager, can change who it is shared with.", 403)
    }
  }

  if (change && input.resource.kind === "document" && row.lifecycle_state !== "active") {
    throw new DocumentServiceError("Only an active document's sharing can change.", 409)
  }

  return target
}

async function accessTo(client: DocumentServiceClient, input: SharingInput): Promise<SharingLevel | null> {
  const asked = { actorUserId: input.actorUserId, organizationId: input.organizationId }

  if (input.resource.kind === "document") return getEffectiveDocumentAccess({ ...asked, documentId: input.resource.id }, client)

  if (input.resource.kind === "folder") return getEffectiveFolderAccess({ ...asked, folderId: input.resource.id }, client)

  const { data, error } = await client.rpc("get_template_access_level", {
    target_actor_user_id: input.actorUserId,
    target_org_id: input.organizationId,
    target_template_id: input.resource.id,
  })

  if (error) throw createSupabaseServiceError(error, "Unable to check access to that template.")

  return (data as SharingLevel | null) ?? null
}

async function listMembers(deps: SharingServiceDeps, input: SharingInput): Promise<OrganizationMember[]> {
  return (deps.listMembers ?? listSharingMembers)(input.organizationId, input.actorUserId)
}

/**
 * Everyone in the workspace, as the Share dialog names them.
 *
 * @param organizationId - The workspace.
 * @param actorUserId - Who is asking.
 * @returns The members.
 */
export async function listSharingMembers(organizationId: string, actorUserId: string): Promise<OrganizationMember[]> {
  return (await listOrganizationPeople(actorUserId, organizationId)).members
}

const nameOf = (member: OrganizationMember | undefined): string | null =>
  member ? (member.workspaceDisplayName || member.fullName || member.email) : null

const personOf = (member: OrganizationMember): SharingPerson => ({
  email: member.email,
  name: nameOf(member) ?? member.email,
  role: member.role,
  userId: member.userId,
})

// Rejects choices that cannot mean anything, and names who is being changed.
function checkPrincipal(
  input: SetSharingAccessInput,
  target: Target,
  people: readonly OrganizationMember[]
): { label: string } {
  const kind = KINDS[input.resource.kind]

  if (input.level !== null && !(kind.levels as readonly SharingLevel[]).includes(input.level)) {
    throw new DocumentServiceError("That level is not available here.", 400)
  }

  // Someone from outside the workspace may look and nothing more.
  const viewsOnly = input.level !== null && input.level !== "viewer"

  if ("role" in input.principal) {
    const { role } = input.principal

    if (!isOrganizationRole(role) || !SHAREABLE_ROLES.includes(role)) {
      throw new DocumentServiceError("That role already has access, or cannot be chosen.", 400)
    }

    if (role === "external_reviewer" && viewsOnly) {
      throw new DocumentServiceError("External reviewers can only view.", 400)
    }

    return { label: role }
  }

  if (!("userId" in input.principal)) throw new DocumentServiceError("Choose someone to share with.", 400)

  const { userId } = input.principal
  const member = people.find((person) => person.userId === userId && person.status === "active")

  // Access can always be taken away, even from someone who has since left.
  if (input.level === null) return { label: nameOf(member) ?? userId }

  if (!member) throw new DocumentServiceError("That person is not in this workspace.", 400)

  if (member.role === "owner_admin" || userId === target.createdBy) {
    throw new DocumentServiceError("That person always has access.", 400)
  }

  if (member.role === "external_reviewer" && viewsOnly) {
    throw new DocumentServiceError("External reviewers can only view.", 400)
  }

  return { label: nameOf(member) ?? member.email }
}

async function findGrant(
  client: DocumentServiceClient,
  table: (typeof KINDS)[SharingResource["kind"]]["grants"],
  where: Record<string, string>,
  principal: MemberPrincipal
): Promise<Row | null> {
  let query = client.from(table as AnyGrants).select("id,access_level")

  for (const [column, value] of Object.entries(where)) query = query.eq(column as "id", value)

  query = "userId" in principal ? query.eq("user_id", principal.userId) : query.eq("organization_role", principal.role)

  const { data, error } = await query.maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to read the sharing.")

  return (data as Row | null) ?? null
}

async function tell(deps: SharingServiceDeps, notice: Parameters<NonNullable<SharingServiceDeps["notify"]>>[0]): Promise<void> {
  try {
    await (deps.notify ?? broadcastSharingNotice)(notice)
  } catch (error: unknown) {
    console.warn("sharing_notice_failed", {
      reason: error instanceof Error ? error.message : "Unknown notice error",
      resourceId: notice.resource.id,
    })
  }
}

async function buildView(
  client: DocumentServiceClient,
  input: SharingInput,
  target: Target,
  deps: SharingServiceDeps
): Promise<SharingView> {
  const kind = KINDS[input.resource.kind]
  const members = await listMembers(deps, input)
  const byId = new Map(members.map((member) => [member.userId, member]))
  const { data, error } = await client
    .from(kind.grants as AnyGrants)
    .select("id,user_id,organization_role,access_level")
    .eq(kind.grantColumn as "org_id", input.resource.id)
    .eq("org_id", input.organizationId)

  if (error) throw createSupabaseServiceError(error, "Unable to read the sharing.")

  const grants: SharingGrant[] = []

  for (const row of (data ?? []) as Row[]) {
    const level = row.access_level as SharingLevel
    const member = byId.get(row.user_id as string)

    if (row.user_id && member) grants.push({ kind: "person", level, person: personOf(member) })
    else if (row.organization_role) grants.push({ kind: "role", level, role: row.organization_role as OrganizationRole })
  }

  const parent = await loadFolder(client, input.organizationId, target.parentId)
  const owner = target.createdBy ? byId.get(target.createdBy) : undefined

  return {
    grants,
    guests: input.resource.kind === "document" ? await listGuests(client, input) : [],
    inherit: target.inherit,
    inherited: target.inherit ? await inheritedFrom(client, input.organizationId, parent, byId) : [],
    members: members.filter((member) => member.status === "active").map(personOf),
    name: target.name,
    outsideLevels: outsideLevels(input.resource, target),
    owner: owner ? personOf(owner) : null,
    parent: parent ? { id: parent.id, name: parent.name } : null,
  }
}

// What someone outside the workspace may be given: one document, and only a
// look at an uploaded file, which cannot be edited here.
function outsideLevels(resource: SharingResource, target: Target): SharingLevel[] {
  if (resource.kind !== "document") return []

  return target.sourceKind === "generated" ? ["viewer", "contributor"] : ["viewer"]
}

const emailSchema = z.email().max(320)

function guestEmail(value: string): string {
  const parsed = emailSchema.safeParse(value.trim().toLowerCase())

  if (!parsed.success) throw new DocumentServiceError("Enter an email address.", 400)

  return parsed.data
}

async function listGuests(client: DocumentServiceClient, input: SharingInput): Promise<SharingGuest[]> {
  const { data, error } = await client
    .from("document_guest_grants")
    .select("email,access_level,accepted_at")
    .eq("document_id", input.resource.id)
    .eq("org_id", input.organizationId)
    .order("email")

  if (error) throw createSupabaseServiceError(error, "Unable to read the sharing.")

  return (data ?? []).map((row) => ({ email: row.email, joined: Boolean(row.accepted_at), level: row.access_level }))
}

type GuestInput = SetSharingAccessInput & { principal: { email: string } }

function checkGuest(input: GuestInput, target: Target): void {
  const levels = outsideLevels(input.resource, target)

  if (levels.length === 0) throw new DocumentServiceError("Only a document can be shared outside the workspace.", 400)

  if (input.level !== null && !levels.includes(input.level)) {
    throw new DocumentServiceError("Someone outside the workspace can only view an uploaded file.", 400)
  }
}

// Invites someone outside the workspace to one document, changes their level,
// or takes it away. The invite holds only a hash of its link; if the email
// cannot go out the invite is taken back, since nobody else could deliver it.
async function shareWithGuest(
  client: DocumentServiceClient,
  input: GuestInput,
  target: Target,
  people: readonly OrganizationMember[],
  deps: SharingServiceDeps
): Promise<void> {
  const { email } = input.principal
  const where = { document_id: input.resource.id, email, org_id: input.organizationId }
  const { data: existing, error: findError } = await client
    .from("document_guest_grants")
    .select("id")
    .eq("org_id", where.org_id)
    .eq("document_id", where.document_id)
    .eq("email", email)
    .maybeSingle()

  if (findError) throw createSupabaseServiceError(findError, "Unable to read the sharing.")

  if (input.level === null) {
    if (existing) {
      const { error } = await client.from("document_guest_grants").delete().eq("id", existing.id).eq("org_id", input.organizationId)

      if (error) throw createSupabaseServiceError(error, "Unable to take that access away.")
    }
  } else if (existing) {
    const { error } = await client
      .from("document_guest_grants")
      .update({ access_level: input.level as DocumentLevel })
      .eq("id", existing.id)
      .eq("org_id", input.organizationId)

    if (error) throw createSupabaseServiceError(error, "Unable to change that access.")
  } else {
    const id = createId(deps)
    const token = deps.createToken?.() ?? createSecureToken()
    const now = deps.now?.() ?? new Date()
    const { error } = await client.from("document_guest_grants").insert({
      ...where,
      access_level: input.level as DocumentLevel,
      id,
      invite_expires_at: new Date(now.getTime() + TOKEN_LIFETIME_MS).toISOString(),
      invite_token_hash: hashToken(token),
      invited_by: input.actorUserId,
    })

    if (error) throw createSupabaseServiceError(error, "Unable to share that.", error.code === "23505" ? 409 : 500)

    try {
      await (deps.inviteGuest ?? sendGuestInviteEmail)({
        documentTitle: target.name,
        grantId: id,
        inviterName: nameOf(people.find((person) => person.userId === input.actorUserId)) ?? "Someone",
        organizationName: await readOrganizationName(client, input.organizationId),
        recipientEmail: email,
        token,
      })
    } catch (error: unknown) {
      console.warn("guest_invite_not_sent", { grantId: id, reason: error instanceof Error ? error.message : "Unknown error" })
      await client.from("document_guest_grants").delete().eq("id", id).eq("org_id", input.organizationId)
      throw new DocumentServiceError("The invite email could not be sent. Try again.", 502)
    }
  }

  // Best effort: the invite may already be in their inbox, so a lost record must not fail the share.
  await recordDocumentAuditLog(deps, {
    action: input.level === null ? KINDS.document.audit.revoked : KINDS.document.audit.granted,
    actorUserId: input.actorUserId,
    metadata: { level: input.level, principal: email, principalKind: "guest" },
    organizationId: input.organizationId,
    targetId: input.resource.id,
    targetType: "document",
  })
}

type DocumentLevel = (typeof KINDS.document.levels)[number]

type FolderRow = { createdBy: string | null; id: string; inherit: boolean; name: string; parentId: string | null }

async function loadFolder(client: DocumentServiceClient, organizationId: string, id: string | null): Promise<FolderRow | null> {
  if (!id) return null

  const { data, error } = await client
    .from("folders")
    .select("id,name,created_by,parent_folder_id,share_inherit")
    .eq("id", id)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) throw createSupabaseServiceError(error, "Unable to read the folder.")

  const row = data as Row | null

  return row
    ? {
        createdBy: (row.created_by as string | null) ?? null,
        id,
        inherit: row.share_inherit !== false,
        name: String(row.name),
        parentId: (row.parent_folder_id as string | null) ?? null,
      }
    : null
}

// What the folders above lend: their people and roles, and their makers (owner
// admins reach everything, so the dialog says so once instead). The walk ends at a folder that does not
// take in what is above it, exactly as the database's does.
async function inheritedFrom(
  client: DocumentServiceClient,
  organizationId: string,
  first: FolderRow | null,
  byId: ReadonlyMap<string, OrganizationMember>
): Promise<SharingInherited[]> {
  const found: SharingInherited[] = []
  const seen = new Set<string>()
  let folder = first

  for (let depth = 0; folder && depth < MAX_FOLDER_DEPTH && !seen.has(folder.id); depth += 1) {
    seen.add(folder.id)

    const { data, error } = await client
      .from("folder_access_grants")
      .select("user_id,organization_role,access_level")
      .eq("folder_id", folder.id)
      .eq("org_id", organizationId)

    if (error) throw createSupabaseServiceError(error, "Unable to read the sharing.")

    for (const row of (data ?? []) as Row[]) {
      const level = row.access_level as SharingLevel
      const member = row.user_id ? byId.get(row.user_id as string) : undefined

      if (member) found.push({ from: folder.name, label: nameOf(member) ?? member.email, level })
      else if (row.organization_role) found.push({ from: folder.name, label: everyoneWho(row.organization_role as OrganizationRole), level })
    }

    const maker = folder.createdBy ? byId.get(folder.createdBy) : undefined

    if (maker && maker.role !== "owner_admin") found.push({ from: folder.name, label: nameOf(maker) ?? maker.email, level: "contributor" })

    if (!folder.inherit) break

    folder = await loadFolder(client, organizationId, folder.parentId)
  }

  return found
}

