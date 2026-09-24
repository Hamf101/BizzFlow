import { createAdminClient } from "@/lib/supabase/admin"
import type {
  OrganizationMutationDeps,
  OrganizationServiceClient,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  createSupabaseServiceError,
  recordOrganizationAuditLog,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import {
  navigationOrderSchema,
  renameNavigationSchema,
  type NavigationPreferences,
} from "@/types/navigation"

type Actor = { actorUserId: string; organizationId: string }
type NavigationMembership = { role: string; navigation_order: string[] }

async function requireMember(
  client: OrganizationServiceClient,
  input: Actor,
): Promise<NavigationMembership> {
  const { data, error } = await client.from("organization_memberships")
    .select("role,navigation_order")
    .eq("org_id", input.organizationId)
    .eq("user_id", input.actorUserId)
    .eq("status", "active")
    .maybeSingle()
  if (error) {
    throw createSupabaseServiceError(error, "Unable to load navigation preferences.")
  }
  if (!data) {
    throw new OrganizationServiceError("You do not have access to this workspace.", 403)
  }
  return data as NavigationMembership
}

async function readLabels(
  client: OrganizationServiceClient,
  organizationId: string,
): Promise<Pick<NavigationPreferences, "labels" | "revision">> {
  const { data, error } = await client.from("organizations")
    .select("navigation_labels,navigation_revision")
    .eq("id", organizationId)
    .maybeSingle()
  if (error) throw createSupabaseServiceError(error, "Unable to load tab names.")
  if (!data) throw new OrganizationServiceError("Workspace not found.", 404)
  return { labels: data.navigation_labels, revision: data.navigation_revision }
}

/**
 * Loads shared names and only the actor's saved order.
 * @param input - Authenticated actor and workspace identifiers.
 * @param deps - Injectable database dependencies.
 * @returns Shared labels, personal ordering, revision, and rename availability.
 * @throws OrganizationServiceError for nonmembers or database failures.
 */
export async function getNavigationPreferences(
  input: Actor,
  deps: OrganizationMutationDeps = {},
): Promise<NavigationPreferences> {
  return runOrganizationOperation("get_navigation_preferences", input, async () => {
    const client = deps.client ?? createAdminClient()
    const member = await requireMember(client, input)
    return {
      ...await readLabels(client, input.organizationId),
      order: member.navigation_order,
      canRename: member.role === "owner_admin",
    }
  })
}

/**
 * Renames a shared tab while protecting concurrent edits with a revision check.
 * @param input - Owner, workspace, stable route, desired name, and loaded revision.
 * @param deps - Injectable database and audit dependencies.
 * @returns Resolves once the new name is persisted.
 * @throws OrganizationServiceError for unauthorized actors, invalid names, stale edits, or failed writes.
 */
export async function renameNavigationTab(
  input: Actor & { href: string; label: string; expectedRevision: number },
  deps: OrganizationMutationDeps = {},
): Promise<void> {
  return runOrganizationOperation("rename_navigation_tab", {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    const member = await requireMember(client, input)
    if (member.role !== "owner_admin") {
      throw new OrganizationServiceError("Only the workspace owner can rename tabs.", 403)
    }
    const parsed = renameNavigationSchema.safeParse(input)
    if (!parsed.success) {
      throw new OrganizationServiceError("Choose a valid tab and a name between 1 and 40 characters.", 400)
    }
    const { href, label, expectedRevision } = parsed.data
    const current = await readLabels(client, input.organizationId)
    if (current.revision !== expectedRevision) {
      throw new OrganizationServiceError("Tab names changed. Refresh and try again.", 409)
    }
    const { data, error } = await client.from("organizations")
      .update({
        navigation_labels: { ...current.labels, [href]: label },
        navigation_revision: expectedRevision + 1,
      })
      .eq("id", input.organizationId)
      .eq("navigation_revision", expectedRevision)
      .select("id")
      .maybeSingle()
    if (error) throw createSupabaseServiceError(error, "Unable to rename tab.")
    if (!data) {
      throw new OrganizationServiceError("Tab names changed. Refresh and try again.", 409)
    }
    await recordOrganizationAuditLog({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "organization.navigation_renamed",
      targetType: "organization",
      targetId: input.organizationId,
      metadata: { href, label },
    }, deps.recordAuditLog)
  })
}

/**
 * Saves ordering on the actor's active membership, available to every role.
 * @param input - Actor, workspace, and desired sequence of stable routes.
 * @param deps - Injectable database dependencies.
 * @returns Resolves once the personal order is persisted.
 * @throws OrganizationServiceError for invalid routes, nonmembers, or failed writes.
 */
export async function saveNavigationOrder(
  input: Actor & { order: string[] },
  deps: OrganizationMutationDeps = {},
): Promise<void> {
  return runOrganizationOperation("save_navigation_order", {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
  }, async () => {
    const client = deps.client ?? createAdminClient()
    await requireMember(client, input)
    const parsed = navigationOrderSchema.safeParse(input.order)
    if (!parsed.success) {
      throw new OrganizationServiceError("Choose each workspace tab at most once.", 400)
    }
    const { data, error } = await client.from("organization_memberships")
      .update({ navigation_order: parsed.data })
      .eq("org_id", input.organizationId)
      .eq("user_id", input.actorUserId)
      .eq("status", "active")
      .select("id")
      .maybeSingle()
    if (error) throw createSupabaseServiceError(error, "Unable to save tab order.")
    if (!data) {
      throw new OrganizationServiceError("You do not have access to this workspace.", 403)
    }
  })
}
