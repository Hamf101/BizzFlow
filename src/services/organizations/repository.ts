import type { OrganizationRole } from "@/lib/permissions"
import type {
  InviteRow,
  MembershipRow,
  OrganizationRow,
  OrganizationServiceClient,
  ProfileRow,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  createAcceptInviteMutationError,
  createMemberRoleMutationError,
  createSupabaseServiceError,
  mapInvite,
  mapMembership,
  mapOrganization,
  normalizeOptionalEmail,
} from "@/services/organizations/shared"
import type {
  Organization,
  OrganizationInvite,
  OrganizationMembership,
} from "@/types/organization"

type CreatePendingInviteRecordInput = {
  organizationId: string
  email: string
  role: OrganizationRole
  token: string
  invitedBy: string
  expiresAt: string
}

type AcceptOrganizationInviteInput = {
  inviteId: string
  token: string
  userId: string
  userEmail: string
}

type UpdateOrganizationMemberRoleInput = {
  organizationId: string
  membershipId: string
  actorUserId: string
  role: OrganizationRole
}

/**
 * Upserts the authenticated user's server-owned profile identity.
 *
 * @param client - Trusted Supabase client.
 * @param userId - Authenticated user identifier.
 * @param email - Optional authenticated email address.
 * @throws OrganizationServiceError when the profile cannot be saved.
 */
export async function ensureProfile(
  client: OrganizationServiceClient,
  userId: string,
  email: string | null
): Promise<void> {
  const normalizedEmail = normalizeOptionalEmail(email)
  const profileInput: { id: string; email?: string } = { id: userId }

  if (normalizedEmail !== null) {
    profileInput.email = normalizedEmail
  }

  const { error } = await client
    .from("profiles")
    .upsert(profileInput, { onConflict: "id" })

  if (error) {
    throw createSupabaseServiceError(error, "Unable to save user profile.")
  }
}

/**
 * Inserts an organization row.
 *
 * @param client - Trusted Supabase client.
 * @param name - Normalized organization name.
 * @param slug - Unique organization slug.
 * @param createdBy - Creator user identifier.
 * @returns Created organization DTO.
 * @throws OrganizationServiceError when the row cannot be created.
 */
export async function createOrganizationRecord(
  client: OrganizationServiceClient,
  name: string,
  slug: string,
  createdBy: string
): Promise<Organization> {
  const { data, error } = await client
    .from("organizations")
    .insert({ name, slug, created_by: createdBy })
    .select("id,name,slug,created_by,created_at,updated_at")
    .single()

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to create organization.")
  }

  return mapOrganization(data as OrganizationRow)
}

/**
 * Deletes an organization during owner-membership rollback.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 */
export async function deleteOrganizationRecord(
  client: OrganizationServiceClient,
  organizationId: string
): Promise<void> {
  await client.from("organizations").delete().eq("id", organizationId)
}

/**
 * Creates the initial owner membership for an organization.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @param userId - Owner user identifier.
 * @returns Created owner membership.
 * @throws OrganizationServiceError when the row cannot be created.
 */
export async function createOwnerMembership(
  client: OrganizationServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationMembership> {
  const { data, error } = await client
    .from("organization_memberships")
    .insert({
      org_id: organizationId,
      user_id: userId,
      role: "owner_admin",
      status: "active",
    })
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .single()

  if (error || !data) {
    throw createSupabaseServiceError(
      error,
      "Unable to create organization owner membership."
    )
  }

  return mapMembership(data as MembershipRow)
}

/**
 * Loads the user's oldest active membership.
 *
 * @param client - Trusted Supabase client.
 * @param userId - User identifier.
 * @returns Active membership, or null when none exists.
 */
export async function getFirstActiveMembership(
  client: OrganizationServiceClient,
  userId: string
): Promise<OrganizationMembership | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      "Unable to load organization membership."
    )
  }

  return data ? mapMembership(data as MembershipRow) : null
}

/**
 * Loads an active membership scoped to an organization and user.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @param userId - User identifier.
 * @returns Active membership, or null when none exists.
 */
export async function getActiveMembership(
  client: OrganizationServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationMembership | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(
      error,
      "Unable to load organization membership."
    )
  }

  return data ? mapMembership(data as MembershipRow) : null
}

/**
 * Loads a membership by identifier.
 *
 * @param client - Trusted Supabase client.
 * @param membershipId - Membership identifier.
 * @returns Membership DTO.
 * @throws OrganizationServiceError when the member is absent.
 */
export async function getMembershipById(
  client: OrganizationServiceClient,
  membershipId: string
): Promise<OrganizationMembership> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("id", membershipId)
    .single()

  if (error) {
    throw createSupabaseServiceError(error, "Member was not found.", 404)
  }

  if (!data) {
    throw new OrganizationServiceError("Member was not found.", 404)
  }

  return mapMembership(data as MembershipRow)
}

/**
 * Lists active memberships for an organization.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @returns Active memberships ordered by creation time.
 */
export async function listActiveMemberships(
  client: OrganizationServiceClient,
  organizationId: string
): Promise<OrganizationMembership[]> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("id,org_id,user_id,role,status,created_at,updated_at")
    .eq("org_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: true })

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to load members.")
  }

  return (data as MembershipRow[]).map(mapMembership)
}

/**
 * Loads an organization by identifier.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @returns Organization DTO.
 * @throws OrganizationServiceError when the organization is absent.
 */
export async function getOrganizationById(
  client: OrganizationServiceClient,
  organizationId: string
): Promise<Organization> {
  const { data, error } = await client
    .from("organizations")
    .select("id,name,slug,created_by,created_at,updated_at")
    .eq("id", organizationId)
    .single()

  if (error) {
    throw createSupabaseServiceError(error, "Organization was not found.", 404)
  }

  if (!data) {
    throw new OrganizationServiceError("Organization was not found.", 404)
  }

  return mapOrganization(data as OrganizationRow)
}

/**
 * Finds a profile by normalized email address.
 *
 * @param client - Trusted Supabase client.
 * @param email - Normalized email address.
 * @returns Matching profile row, or null.
 */
export async function getProfileByEmail(
  client: OrganizationServiceClient,
  email: string
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name")
    .eq("email", email)
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to check existing profile.")
  }

  return data ? (data as ProfileRow) : null
}

/**
 * Loads profiles for a membership user set.
 *
 * @param client - Trusted Supabase client.
 * @param userIds - User identifiers.
 * @returns Matching profile rows.
 */
export async function listProfilesByUserIds(
  client: OrganizationServiceClient,
  userIds: string[]
): Promise<ProfileRow[]> {
  if (userIds.length === 0) {
    return []
  }

  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name")
    .in("id", userIds)

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to load member profiles.")
  }

  return data as ProfileRow[]
}

/**
 * Revokes previous pending invites before issuing a replacement.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @param email - Normalized invite email.
 */
export async function revokePendingInvitesForEmail(
  client: OrganizationServiceClient,
  organizationId: string,
  email: string
): Promise<void> {
  await client
    .from("invites")
    .update({ status: "revoked" })
    .eq("org_id", organizationId)
    .eq("email", email)
    .eq("status", "pending")
}

/**
 * Inserts a pending organization invite.
 *
 * @param client - Trusted Supabase client.
 * @param input - Tenant, recipient, role, token, inviter, and expiry values.
 * @returns Created invite DTO.
 */
export async function createPendingInviteRecord(
  client: OrganizationServiceClient,
  input: CreatePendingInviteRecordInput
): Promise<OrganizationInvite> {
  const { data, error } = await client
    .from("invites")
    .insert({
      org_id: input.organizationId,
      email: input.email,
      role: input.role,
      token: input.token,
      invited_by: input.invitedBy,
      expires_at: input.expiresAt,
    })
    .select("id,org_id,email,role,token,status,expires_at,created_at")
    .single()

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to create invite.")
  }

  return mapInvite(data as InviteRow)
}

/**
 * Lists pending invites for an organization.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Organization identifier.
 * @returns Pending invites ordered newest first.
 */
export async function listPendingInvites(
  client: OrganizationServiceClient,
  organizationId: string
): Promise<OrganizationInvite[]> {
  const { data, error } = await client
    .from("invites")
    .select("id,org_id,email,role,token,status,expires_at,created_at")
    .eq("org_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (error || !data) {
    throw createSupabaseServiceError(error, "Unable to load pending invites.")
  }

  return (data as InviteRow[]).map(mapInvite)
}

/**
 * Loads a non-expired pending invite by token.
 *
 * @param client - Trusted Supabase client.
 * @param token - Opaque invite token.
 * @returns Pending invite DTO.
 * @throws OrganizationServiceError when the invite is invalid or expired.
 */
export async function getPendingInviteByToken(
  client: OrganizationServiceClient,
  token: string
): Promise<OrganizationInvite> {
  const { data, error } = await client
    .from("invites")
    .select("id,org_id,email,role,token,status,expires_at,created_at")
    .eq("token", token)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (error) {
    throw createSupabaseServiceError(error, "Unable to load invite.")
  }

  if (!data) {
    throw new OrganizationServiceError("Invite is invalid or expired.", 404)
  }

  return mapInvite(data as InviteRow)
}

/**
 * Accepts an invite through the transactional database RPC.
 *
 * @param client - Trusted Supabase client.
 * @param input - Invite and authenticated identity values.
 * @returns Created or reactivated membership identifier.
 */
export async function acceptOrganizationInvite(
  client: OrganizationServiceClient,
  input: AcceptOrganizationInviteInput
): Promise<string> {
  const { data, error } = await client.rpc("accept_organization_invite", {
    target_invite_id: input.inviteId,
    target_token: input.token,
    target_user_id: input.userId,
    target_user_email: input.userEmail,
  })

  if (error || !data) {
    throw createAcceptInviteMutationError(error)
  }

  return data
}

/**
 * Updates a membership role through the locked database RPC.
 *
 * @param client - Trusted Supabase client.
 * @param input - Tenant, membership, actor, and target role values.
 * @returns Updated membership identifier.
 */
export async function updateOrganizationMemberRole(
  client: OrganizationServiceClient,
  input: UpdateOrganizationMemberRoleInput
): Promise<string> {
  const { data, error } = await client.rpc(
    "update_organization_member_role",
    {
      target_org_id: input.organizationId,
      target_membership_id: input.membershipId,
      target_actor_user_id: input.actorUserId,
      target_role: input.role,
    }
  )

  if (error || data !== input.membershipId) {
    throw createMemberRoleMutationError(error)
  }

  return data
}

/**
 * Revokes an invite whose delivery failed, logging cleanup failures for operators.
 *
 * @param client - Trusted Supabase client.
 * @param inviteId - Invite identifier.
 * @param organizationId - Organization identifier for log context.
 */
export async function revokeUndeliveredInvite(
  client: OrganizationServiceClient,
  inviteId: string,
  organizationId: string
): Promise<void> {
  const { error } = await client
    .from("invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending")

  if (error) {
    console.error("undelivered_invite_revoke_failed", {
      inviteId,
      organizationId,
      reason: error.message,
    })
  }
}
