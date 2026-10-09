import type { PostgrestError } from "@supabase/supabase-js"
import { cache } from "react"

import {
  canPerformOrganizationAction,
  createOrganizationPermissionSubject,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import type { AdminSupabaseClient } from "@/lib/supabase/admin"

// Every column a membership check reads, so all of them can share one read.
const ACTIVE_MEMBERSHIP_COLUMNS =
  "id,org_id,user_id,role,role_definition_id,workspace_display_name,status,created_at,updated_at,navigation_order,email_notifications_enabled,sms_notifications_enabled,role_definition:organization_roles!organization_memberships_role_definition_fk(id,name,system_key,permissions)"

/**
 * Reads someone's active membership of one organization. Each service a page
 * calls checks it, so within one render the read happens once and the checks
 * share it. Nothing outlives the render, and actions and route handlers read
 * afresh every time, so a changed role or setting counts from the next page.
 *
 * A stored role this build does not know reads as no membership, so every
 * caller fails closed with its own "denied" answer rather than a 500.
 *
 * @param client - The admin client, which one request shares throughout.
 * @param organizationId - The organization.
 * @param userId - The member.
 * @returns The query result: the membership row, or null.
 */
export const loadActiveMembership = cache(
  async (client: Pick<AdminSupabaseClient, "from">, organizationId: string, userId: string) => {
    const result = await client
      .from("organization_memberships")
      .select(ACTIVE_MEMBERSHIP_COLUMNS)
      .eq("org_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle()

    if (result.data && !isOrganizationRole(result.data.role)) {
      console.warn("organization_membership_unknown_role", {
        organizationId,
        userId,
        membershipId: result.data.id,
      })
      return { ...result, data: null }
    }

    return result
  }
)

/** How a domain reports each way a permission check can fail, in its own words. */
export type OrgPermissionFailures = {
  /** The membership read failed. */
  loadFailed: (error: PostgrestError) => Error
  /** No active membership (an unknown stored role counts), or one without the permission. */
  denied: () => Error
}

/**
 * Requires an active membership whose current role-definition permissions
 * include the action.
 *
 * @param client - The admin client.
 * @param organizationId - The organization.
 * @param userId - The member.
 * @param action - The permission needed, or null for membership alone.
 * @param fail - The domain's errors for each failure.
 * @returns The member's permission subject.
 */
export async function requireOrgPermission(
  client: Pick<AdminSupabaseClient, "from">,
  organizationId: string,
  userId: string,
  action: OrganizationPermissionAction | null,
  fail: OrgPermissionFailures
): Promise<OrganizationPermissionSubject> {
  const { data, error } = await loadActiveMembership(client, organizationId, userId)

  if (error) throw fail.loadFailed(error)
  if (!data) throw fail.denied()

  const subject = createOrganizationPermissionSubject(data.role, data.role_definition?.permissions)

  if (!subject || (action && !canPerformOrganizationAction(subject, action))) throw fail.denied()

  return subject
}
