import type { AdminSupabaseClient } from "@/lib/supabase/admin"

/** How far a member reaches for work (see member_reach in the database). */
export type MemberReach = {
  /** Whose submitted work they look over: direct reports, and the teams they lead. */
  supervised: string[]
  /** Who they see when their role is narrowed; null when their reach is everyone. */
  visible: string[] | null
}

/**
 * Loads a member's reach for work, once per request that lists or opens it.
 *
 * @param client - Trusted database client.
 * @param organizationId - Tenant identifier.
 * @param userId - The member.
 * @returns Who they look over, and who they see (null when everyone).
 * @throws Error when the database cannot answer.
 */
export async function loadMemberReach(
  client: Pick<AdminSupabaseClient, "rpc">,
  organizationId: string,
  userId: string
): Promise<MemberReach> {
  const { data, error } = await client.rpc("member_reach", { target_org_id: organizationId, target_user_id: userId })

  if (error || !data || typeof data !== "object") {
    throw new Error("Unable to load who this member can see.")
  }

  const reach = data as { everyone?: boolean; supervised?: string[] | null; visible?: string[] | null }
  return { supervised: reach.supervised ?? [], visible: reach.everyone ? null : (reach.visible ?? []) }
}
