import { createAdminClient } from "@/lib/supabase/admin"
import type { OrganizationMutationDeps } from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import { getActiveMembership } from "@/services/organizations/repository"
import { recordOrganizationAuditLog, runOrganizationOperation } from "@/services/organizations/shared"

/** How far a role sees: everyone, its own branch, or its inviter's side. */
type VisibilityScope = "everyone" | "branch" | "inviter"

type Actor = { actorUserId: string; organizationId: string }

/** The workspace's teams, reporting lines, and each role's reach. */
export type OrganizationStructure = {
  units: Array<{ id: string; name: string; parentId: string | null; members: Array<{ isLead: boolean; userId: string }> }>
  /** Each member's manager, by user id; only those with one. */
  managers: Record<string, string>
  roles: Array<{ id: string; name: string; systemKey: string | null; scope: VisibilityScope; setByOwner: boolean }>
}

type Client = NonNullable<OrganizationMutationDeps["client"]>

/**
 * Reads the workspace's structure for its owner to arrange.
 *
 * @param input - The owner and tenant.
 * @param deps - Optional database dependency for tests.
 * @returns Teams with their members, reporting lines, and each role's reach.
 */
export async function getOrganizationStructure(input: Actor, deps: OrganizationMutationDeps = {}): Promise<OrganizationStructure> {
  return runOrganizationOperation("get_organization_structure", input, async () => {
    const client = deps.client ?? createAdminClient()
    await requireOwner(client, input)
    const [units, members, memberships, roles] = await Promise.all([
      client.from("org_units").select("id,name,parent_id").eq("org_id", input.organizationId).order("name", { ascending: true }),
      client.from("org_unit_members").select("unit_id,user_id,is_lead").eq("org_id", input.organizationId),
      client.from("organization_memberships").select("user_id,manager_user_id").eq("org_id", input.organizationId).eq("status", "active"),
      client.from("organization_roles").select("id,name,system_key,visibility_scope").eq("org_id", input.organizationId).is("archived_at", null),
    ])
    const failed = units.error ?? members.error ?? memberships.error ?? roles.error

    if (failed) {
      throw new OrganizationServiceError("Unable to load the workspace's teams.", 500)
    }

    const unitMembers = (members.data ?? []) as Array<{ is_lead: boolean; unit_id: string; user_id: string }>

    return {
      units: ((units.data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>).map((unit) => ({
        id: unit.id,
        name: unit.name,
        parentId: unit.parent_id,
        members: unitMembers.filter((member) => member.unit_id === unit.id).map((member) => ({ isLead: member.is_lead, userId: member.user_id })),
      })),
      managers: Object.fromEntries(
        ((memberships.data ?? []) as Array<{ manager_user_id: string | null; user_id: string }>)
          .filter((membership) => membership.manager_user_id)
          .map((membership) => [membership.user_id, membership.manager_user_id as string])
      ),
      roles: ((roles.data ?? []) as Array<{ id: string; name: string; system_key: string | null; visibility_scope: VisibilityScope | null }>).map((role) => ({
        id: role.id,
        name: role.name,
        systemKey: role.system_key,
        scope: role.system_key === "owner_admin" ? "everyone" : (role.visibility_scope ?? defaultScope(role.system_key)),
        setByOwner: role.visibility_scope !== null,
      })),
    }
  })
}

/** One change an owner makes to the structure. */
export type OrganizationStructureChange =
  | { kind: "save_unit"; unitId?: string; name: string; parentId: string | null }
  | { kind: "delete_unit"; unitId: string }
  | { kind: "set_unit_member"; unitId: string; userId: string; place: "member" | "lead" | null }
  | { kind: "set_manager"; userId: string; managerUserId: string | null }
  | { kind: "set_role_scope"; roleId: string; scope: VisibilityScope | null }

/**
 * Applies one change to the workspace's structure. A team inside its own
 * sub-team, or a reporting line that loops, is refused by the database.
 *
 * @param input - The owner, tenant, and the change.
 * @param deps - Optional database and audit dependencies for tests.
 * @throws OrganizationServiceError: 403 not the owner, 400 a refused shape, 404 an unknown team or member.
 */
export async function changeOrganizationStructure(
  input: Actor & { change: OrganizationStructureChange },
  deps: OrganizationMutationDeps = {}
): Promise<void> {
  return runOrganizationOperation("change_organization_structure", { ...input, change: input.change.kind }, async () => {
    const client = deps.client ?? createAdminClient()
    const org = input.organizationId
    const change = input.change
    await requireOwner(client, input)

    const result = await (async () => {
      switch (change.kind) {
        case "save_unit": {
          const name = change.name.trim()

          if (name.length < 1 || name.length > 80) {
            throw new OrganizationServiceError("Name the team in up to 80 characters.", 400)
          }

          return change.unitId
            ? client.from("org_units").update({ name, parent_id: change.parentId }).eq("org_id", org).eq("id", change.unitId).select("id")
            : client.from("org_units").insert({ org_id: org, name, parent_id: change.parentId }).select("id")
        }
        case "delete_unit":
          return client.from("org_units").delete().eq("org_id", org).eq("id", change.unitId).select("id")
        case "set_unit_member":
          return change.place
            ? client
                .from("org_unit_members")
                .upsert({ org_id: org, unit_id: change.unitId, user_id: change.userId, is_lead: change.place === "lead" })
                .select("unit_id")
            : client.from("org_unit_members").delete().eq("org_id", org).eq("unit_id", change.unitId).eq("user_id", change.userId).select("unit_id")
        case "set_manager":
          return client
            .from("organization_memberships")
            .update({ manager_user_id: change.managerUserId })
            .eq("org_id", org)
            .eq("user_id", change.userId)
            .select("user_id")
        case "set_role_scope": {
          // An owner's reach is everything, always. Asked first, as a custom role's key is null, which no SQL filter on it lets through.
          const role = await client.from("organization_roles").select("system_key").eq("org_id", org).eq("id", change.roleId)

          if (role.error || (role.data ?? []).some((row) => row.system_key === "owner_admin")) {
            return { data: [], error: role.error }
          }

          return client.from("organization_roles").update({ visibility_scope: change.scope }).eq("org_id", org).eq("id", change.roleId).select("id")
        }
      }
    })()

    if (result.error) {
      throw toStructureError(result.error)
    }

    // A removal of what was not there changes nothing and is fine; anything else must land.
    if ((result.data ?? []).length === 0 && change.kind !== "delete_unit" && !(change.kind === "set_unit_member" && !change.place)) {
      throw new OrganizationServiceError("That team, member or role was not found.", 404)
    }

    await recordOrganizationAuditLog(
      {
        organizationId: org,
        actorUserId: input.actorUserId,
        action: "organization.structure_changed",
        targetType: "organization",
        targetId: org,
        metadata: { change: change.kind },
      },
      deps.recordAuditLog
    )
  })
}

function defaultScope(systemKey: string | null): VisibilityScope {
  return systemKey === "external_reviewer" ? "inviter" : systemKey === "staff" ? "branch" : "everyone"
}

function toStructureError(error: { code?: string; message?: string }): OrganizationServiceError {
  if (error.code === "23514") {
    return new OrganizationServiceError(
      error.message?.startsWith("A team") || error.message?.startsWith("Someone")
        ? error.message
        : "That would put someone or a team in a loop.",
      400
    )
  }

  if (error.code === "23503") {
    return new OrganizationServiceError("That team or member was not found.", 404)
  }

  return new OrganizationServiceError("Unable to change the workspace's teams.", 500)
}

async function requireOwner(client: Client, input: Actor): Promise<void> {
  const actor = await getActiveMembership(client, input.organizationId, input.actorUserId)

  if (actor?.role !== "owner_admin") {
    throw new OrganizationServiceError("Only an organization owner can arrange teams.", 403)
  }
}
