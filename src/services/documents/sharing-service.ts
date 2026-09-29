import { canPerformOrganizationAction, isOrganizationRole, type OrganizationRole } from "@/lib/permissions"
import { getEffectiveDocumentAccess, getEffectiveFolderAccess } from "@/services/documents/access-service"
import { recordRequiredDocumentAuditLog } from "@/services/documents/audit"
import type { DocumentServiceClient } from "@/services/documents/contracts"
import { DocumentServiceError } from "@/services/documents/errors"
import { broadcastSharingNotice } from "@/services/documents/sharing-notice"
import { everyoneWho } from "@/services/documents/sharing-words"
import type {
  SetSharingAccessInput,
  SetSharingInheritanceInput,
  SharingGrant,
  SharingInherited,
  SharingInput,
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
import type { DocumentAccessLevel } from "@/types/document"
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
    nameColumn: "name",
    parentColumn: "parent_folder_id",
    table: "folders",
  },
} as const satisfies Record<SharingResource["kind"], { audit: Record<string, AuditLogAction> } & Record<string, unknown>>

const MAX_FOLDER_DEPTH = 50
// Roles a share can name. Owner admins always have access and are never granted it.
const SHAREABLE_ROLES: readonly OrganizationRole[] = ["manager", "staff", "external_reviewer"]

type Target = {
  createdBy: string | null
  inherit: boolean
  name: string
  parentId: string | null
}

type Row = Record<string, unknown>

// The database is typed per table; these two names are chosen at run time.
type AnyTable = "documents"
type AnyGrants = "document_access_grants"

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

/**
 * Shares an item with a person or a role, changes the level, or takes the
 * access away (level null). A person newly added is told; a failed notice never
 * undoes the share.
 *
 * @param input - Actor, organization, item, who, and what level.
 * @param deps - Injected client, ids, people lookup, notice and audit for tests.
 * @returns The sharing of the item afterwards.
 * @throws DocumentServiceError when the actor may not share it or the choice is not allowed.
 */
export async function setSharingAccess(input: SetSharingAccessInput, deps: SharingServiceDeps = {}): Promise<SharingView> {
  return runDocumentOperation("set_sharing_access", identifiers(input), async () => {
    const client = getClient(deps)
    const target = await authorize(client, input)
    const kind = KINDS[input.resource.kind]
    const people = await listMembers(deps, input)
    const who = await checkPrincipal(input, target, people)
    const where = { [kind.grantColumn]: input.resource.id, org_id: input.organizationId }
    const existing = await findGrant(client, kind.grants, where, input.principal)
    const grants = client.from(kind.grants as AnyGrants)

    if (input.level === null) {
      if (existing) {
        const { error } = await client
          .from(kind.grants as AnyGrants)
          .delete()
          .eq("id", existing.id as string)
          .eq("org_id", input.organizationId)

        if (error) throw createSupabaseServiceError(error, "Unable to take that access away.")
      }
    } else if (existing) {
      const { error } = await client
        .from(kind.grants as AnyGrants)
        .update({ access_level: input.level, granted_by: input.actorUserId } as Row)
        .eq("id", existing.id as string)
        .eq("org_id", input.organizationId)

      if (error) throw createSupabaseServiceError(error, "Unable to change that access.")
    } else {
      const { error } = await grants.insert({
        ...where,
        access_level: input.level,
        granted_by: input.actorUserId,
        id: createId(deps),
        organization_role: "role" in input.principal ? input.principal.role : null,
        user_id: "userId" in input.principal ? input.principal.userId : null,
      } as never)

      if (error) throw createSupabaseServiceError(error, "Unable to share that.", error.code === "23505" ? 409 : 500)
    }

    await recordRequiredDocumentAuditLog(deps, {
      action: input.level === null ? kind.audit.revoked : kind.audit.granted,
      actorUserId: input.actorUserId,
      metadata: {
        level: input.level,
        principal: who.label,
        principalKind: "role" in input.principal ? "role" : "person",
      },
      organizationId: input.organizationId,
      targetId: input.resource.id,
      targetType: input.resource.kind,
    })

    if (input.level !== null && !existing && "userId" in input.principal && input.principal.userId !== input.actorUserId) {
      await tell(deps, {
        actorName: nameOf(people.find((person) => person.userId === input.actorUserId)) ?? "Someone",
        level: input.level,
        recipientUserId: input.principal.userId,
        resource: input.resource,
        resourceName: target.name,
      })
    }

    return buildView(client, input, target, deps)
  })
}

/**
 * Chooses whether an item also takes in what the folders above it are shared with.
 *
 * @param input - Actor, organization, item, and the choice.
 * @param deps - Injected client, people lookup and audit for tests.
 * @returns The sharing of the item afterwards.
 * @throws DocumentServiceError when the actor may not change its sharing.
 */
export async function setSharingInheritance(
  input: SetSharingInheritanceInput,
  deps: SharingServiceDeps = {}
): Promise<SharingView> {
  return runDocumentOperation("set_sharing_inheritance", identifiers(input), async () => {
    const client = getClient(deps)
    const target = await authorize(client, input)
    const kind = KINDS[input.resource.kind]
    const { error } = await client
      .from(kind.table as AnyTable)
      .update({ share_inherit: input.inherit } as Row)
      .eq("id", input.resource.id)
      .eq("org_id", input.organizationId)

    if (error) throw createSupabaseServiceError(error, "Unable to change that.")

    await recordRequiredDocumentAuditLog(deps, {
      action: kind.audit.inheritance,
      actorUserId: input.actorUserId,
      metadata: { inherit: input.inherit },
      organizationId: input.organizationId,
      targetId: input.resource.id,
      targetType: input.resource.kind,
    })

    return buildView(client, input, { ...target, inherit: input.inherit }, deps)
  })
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
// cannot open it is told it does not exist.
async function authorize(client: DocumentServiceClient, input: SharingInput): Promise<Target> {
  const kind = KINDS[input.resource.kind]
  const notFound = new DocumentServiceError(`${kind.label} was not found.`, 404)
  const membership = await getActiveMembership(client, input.organizationId, input.actorUserId)

  if (!membership) throw notFound

  const { data, error } = await client
    .from(kind.table as AnyTable)
    .select(`id,created_by,share_inherit,${kind.nameColumn},${kind.parentColumn}`)
    .eq("id", input.resource.id)
    .eq("org_id", input.organizationId)
    .maybeSingle()

  if (error) throw createSupabaseServiceError(error, `Unable to load that ${kind.label.toLowerCase()}.`)

  if (!data) throw notFound

  const row = data as Row
  const target: Target = {
    createdBy: (row.created_by as string | null) ?? null,
    inherit: row.share_inherit !== false,
    name: String(row[kind.nameColumn]),
    parentId: (row[kind.parentColumn] as string | null) ?? null,
  }
  const made = target.createdBy === input.actorUserId
  const canManage = canPerformOrganizationAction(membership, "folders:manage")

  if (!made && membership.role !== "owner_admin") {
    const access =
      input.resource.kind === "document"
        ? await getEffectiveDocumentAccess({ actorUserId: input.actorUserId, documentId: input.resource.id, organizationId: input.organizationId }, client)
        : await getEffectiveFolderAccess({ actorUserId: input.actorUserId, folderId: input.resource.id, organizationId: input.organizationId }, client)

    if (access === null) throw notFound

    // Whoever can edit it may pass it on; someone who can only view it may not, unless they manage folders.
    if (access !== "contributor" && !canManage) {
      throw new DocumentServiceError("Only someone who can edit this, or a manager, can change who it is shared with.", 403)
    }
  }

  return target
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
async function checkPrincipal(
  input: SetSharingAccessInput,
  target: Target,
  people: readonly OrganizationMember[]
): Promise<{ label: string }> {
  if ("role" in input.principal) {
    const { role } = input.principal

    if (!isOrganizationRole(role) || !SHAREABLE_ROLES.includes(role)) {
      throw new DocumentServiceError("That role already has access, or cannot be chosen.", 400)
    }

    if (role === "external_reviewer" && input.level === "contributor") {
      throw new DocumentServiceError("External reviewers can only view.", 400)
    }

    return { label: role }
  }

  const { userId } = input.principal
  const member = people.find((person) => person.userId === userId && person.status === "active")

  if (!member) throw new DocumentServiceError("That person is not in this workspace.", 400)

  if (member.role === "owner_admin" || userId === target.createdBy) {
    throw new DocumentServiceError("That person always has access.", 400)
  }

  if (member.role === "external_reviewer" && input.level === "contributor") {
    throw new DocumentServiceError("External reviewers can only view.", 400)
  }

  return { label: nameOf(member) ?? member.email }
}

async function findGrant(
  client: DocumentServiceClient,
  table: (typeof KINDS)[SharingResource["kind"]]["grants"],
  where: Record<string, string>,
  principal: SharingPrincipal
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
    const level = row.access_level as DocumentAccessLevel
    const member = byId.get(row.user_id as string)

    if (row.user_id && member) grants.push({ kind: "person", level, person: personOf(member) })
    else if (row.organization_role) grants.push({ kind: "role", level, role: row.organization_role as OrganizationRole })
  }

  const parent = await loadFolder(client, input.organizationId, target.parentId)
  const owner = target.createdBy ? byId.get(target.createdBy) : undefined

  return {
    grants,
    inherit: target.inherit,
    inherited: target.inherit ? await inheritedFrom(client, input.organizationId, parent, byId) : [],
    members: members.filter((member) => member.status === "active").map(personOf),
    name: target.name,
    owner: owner ? personOf(owner) : null,
    parent: parent ? { id: parent.id, name: parent.name } : null,
  }
}

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
      const level = row.access_level as DocumentAccessLevel
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

