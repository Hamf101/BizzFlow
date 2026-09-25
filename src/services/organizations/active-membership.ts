import { cache } from "react"

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
 * @param client - The admin client, which one request shares throughout.
 * @param organizationId - The organization.
 * @param userId - The member.
 * @returns The query result: the membership row, or null.
 */
export const loadActiveMembership = cache(
  async (client: Pick<AdminSupabaseClient, "from">, organizationId: string, userId: string) =>
    client
      .from("organization_memberships")
      .select(ACTIVE_MEMBERSHIP_COLUMNS)
      .eq("org_id", organizationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle()
)
