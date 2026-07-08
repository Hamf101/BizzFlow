import { randomUUID } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import { recordAuditLog } from "@/services/audit-service"
import {
  canInviteMembers,
  canUpdateMemberRole,
  getAssignableOrganizationRoles,
  isOrganizationRole,
  type OrganizationRole,
} from "@/lib/permissions"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"
import type {
  InvitePreview,
  InviteStatus,
  MembershipStatus,
  Organization,
  OrganizationContext,
  OrganizationInvite,
  OrganizationMember,
  OrganizationMembership,
} from "@/types/organization"

type AdminClient = ReturnType<typeof createAdminClient>

type LogValue = string | number | boolean | null | undefined

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

type OrganizationRow = {
  id: string
  name: string
  slug: string
  created_by: string | null
  created_at: string
  updated_at: string
}

type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
}

type MembershipRow = {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

type InviteRow = {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  status: string
  expires_at: string
  created_at: string
}

type CreateOrganizationInput = {
  userId: string
  userEmail: string | null
  name: string
}

type CreateInviteInput = {
  actorUserId: string
  organizationId: string
  email: string
  role: OrganizationRole
}

type AcceptInviteInput = {
  userId: string
  userEmail: string | null
  token: string
}

type UpdateMemberRoleInput = {
  actorUserId: string
  organizationId: string
  membershipId: string
  role: OrganizationRole
}

/**
 * Error type raised by organization service operations.
 */
export class OrganizationServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a service error with an HTTP-style status code.
   *
   * @param message - User-safe error message.
   * @param statusCode - HTTP-style status code for route/action translation.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "OrganizationServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Creates an organization and owner membership for an authenticated user.
 *
 * @param input - Authenticated user and organization form values.
 * @returns Created organization context.
 * @throws OrganizationServiceError when validation or Supabase writes fail.
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<OrganizationContext> {
  return runOrganizationOperation(
    "create_organization",
    { userId: input.userId, email: input.userEmail },
    async (): Promise<OrganizationContext> => {
      const client = createAdminClient()
      const name = normalizeOrganizationName(input.name)

      await ensureProfile(client, input.userId, input.userEmail)

      const { data: organizationData, error: organizationError } = await client
        .from("organizations")
        .insert({
          name,
          slug: createOrganizationSlug(name),
          created_by: input.userId,
        })
        .select("id,name,slug,created_by,created_at,updated_at")
        .single()

      if (organizationError || !organizationData) {
        throw createSupabaseServiceError(
          organizationError,
          "Unable to create organization."
        )
      }

      const organization = mapOrganization(organizationData as OrganizationRow)

      const { data: membershipData, error: membershipError } = await client
        .from("organization_memberships")
        .insert({
          org_id: organization.id,
          user_id: input.userId,
          role: "owner_admin",
          status: "active",
        })
        .select("id,org_id,user_id,role,status,created_at,updated_at")
        .single()

      if (membershipError || !membershipData) {
        await client.from("organizations").delete().eq("id", organization.id)
        throw createSupabaseServiceError(
          membershipError,
          "Unable to create organization owner membership.",
        )
      }

      await recordOrganizationAuditLog({
        organizationId: organization.id,
        actorUserId: input.userId,
        action: "organization.created",
        targetType: "organization",
        targetId: organization.id,
        metadata: { role: "owner_admin" },
      })

      return {
        organization,
        membership: mapMembership(membershipData as MembershipRow),
      }
    }
  )
}

/**
 * Loads the first active organization context for an authenticated user.
 *
 * @param userId - Authenticated Supabase user id.
 * @returns Current organization context, or null when the user has none.
 * @throws OrganizationServiceError when Supabase reads fail.
 */
export async function getCurrentOrganizationContext(
  userId: string
): Promise<OrganizationContext | null> {
  return runOrganizationOperation(
    "get_current_organization_context",
    { userId },
    async (): Promise<OrganizationContext | null> => {
      const client = createAdminClient()
      const membership = await getFirstActiveMembership(client, userId)

      if (!membership) {
        return null
      }

      const organization = await getOrganizationById(client, membership.organizationId)

      return { organization, membership }
    }
  )
}

/**
 * Creates a pending invite for an organization.
 *
 * @param input - Actor, organization, email, and role for the invite.
 * @returns Created pending invite.
 * @throws OrganizationServiceError when the actor lacks permission or writes fail.
 */
export async function createInvite(
  input: CreateInviteInput
): Promise<OrganizationInvite> {
  return runOrganizationOperation(
    "create_invite",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      invitedEmail: input.email,
      role: input.role,
    },
    async (): Promise<OrganizationInvite> => {
      const client = createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        input.organizationId,
        input.actorUserId
      )

      if (!actorMembership || !canInviteMembers(actorMembership.role)) {
        throw new OrganizationServiceError("You cannot invite members.", 403)
      }

      if (!getAssignableOrganizationRoles().includes(input.role)) {
        throw new OrganizationServiceError("That role cannot be assigned by invite.", 400)
      }

      const email = normalizeEmail(input.email)
      const existingProfile = await getProfileByEmail(client, email)

      if (existingProfile) {
        const existingMembership = await getActiveMembership(
          client,
          input.organizationId,
          existingProfile.id
        )

        if (existingMembership) {
          throw new OrganizationServiceError("That user is already a member.", 409)
        }
      }

      await client
        .from("invites")
        .update({ status: "revoked" })
        .eq("org_id", input.organizationId)
        .eq("email", email)
        .eq("status", "pending")

      const { data, error } = await client
        .from("invites")
        .insert({
          org_id: input.organizationId,
          email,
          role: input.role,
          token: createInviteToken(),
          invited_by: input.actorUserId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("id,org_id,email,role,token,status,expires_at,created_at")
        .single()

      if (error || !data) {
        throw createSupabaseServiceError(error, "Unable to create invite.")
      }

      const invite = mapInvite(data as InviteRow)

      await recordOrganizationAuditLog({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "invite.created",
        targetType: "invite",
        targetId: invite.id,
        metadata: { email: invite.email, role: invite.role },
      })

      return invite
    }
  )
}

/**
 * Loads organization members and pending invites for the People page.
 *
 * @param userId - Authenticated Supabase user id.
 * @param organizationId - Organization id to load.
 * @returns Members and pending invites visible to the user.
 * @throws OrganizationServiceError when the user lacks access or reads fail.
 */
export async function listOrganizationPeople(
  userId: string,
  organizationId: string
): Promise<{
  members: OrganizationMember[]
  pendingInvites: OrganizationInvite[]
}> {
  return runOrganizationOperation(
    "list_organization_people",
    { userId, organizationId },
    async (): Promise<{
      members: OrganizationMember[]
      pendingInvites: OrganizationInvite[]
    }> => {
      const client = createAdminClient()
      const actorMembership = await getActiveMembership(client, organizationId, userId)

      if (!actorMembership) {
        throw new OrganizationServiceError("You do not have access to this organization.", 403)
      }

      const { data: membershipData, error: membershipError } = await client
        .from("organization_memberships")
        .select("id,org_id,user_id,role,status,created_at,updated_at")
        .eq("org_id", organizationId)
        .eq("status", "active")
        .order("created_at", { ascending: true })

      if (membershipError || !membershipData) {
        throw createSupabaseServiceError(membershipError, "Unable to load members.")
      }

      const memberships = (membershipData as MembershipRow[]).map(mapMembership)
      const profiles = await listProfilesByUserIds(
        client,
        memberships.map((membership: OrganizationMembership) => membership.userId)
      )
      const profileById = new Map(
        profiles.map((profile: ProfileRow) => [profile.id, profile])
      )

      const { data: inviteData, error: inviteError } = await client
        .from("invites")
        .select("id,org_id,email,role,token,status,expires_at,created_at")
        .eq("org_id", organizationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })

      if (inviteError || !inviteData) {
        throw createSupabaseServiceError(
          inviteError,
          "Unable to load pending invites."
        )
      }

      return {
        members: memberships.map((membership: OrganizationMembership) => {
          const profile = profileById.get(membership.userId)

          return {
            id: membership.id,
            userId: membership.userId,
            email: profile?.email ?? "Unknown email",
            fullName: profile?.full_name ?? null,
            role: membership.role,
            status: membership.status,
            createdAt: membership.createdAt,
          }
        }),
        pendingInvites: (inviteData as InviteRow[]).map(mapInvite),
      }
    }
  )
}

/**
 * Loads a pending invite preview by token.
 *
 * @param token - Invite token from the URL.
 * @returns Invite preview with organization name.
 * @throws OrganizationServiceError when the invite is missing or expired.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  return runOrganizationOperation(
    "get_invite_preview",
    { tokenLength: token.length },
    async (): Promise<InvitePreview> => {
      const client = createAdminClient()
      const invite = await getPendingInviteByToken(client, token)
      const organization = await getOrganizationById(client, invite.organizationId)

      return {
        id: invite.id,
        organizationName: organization.name,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      }
    }
  )
}

/**
 * Accepts a pending invite for the authenticated user.
 *
 * @param input - Authenticated user and invite token.
 * @returns Organization context after accepting the invite.
 * @throws OrganizationServiceError when the invite is invalid or writes fail.
 */
export async function acceptInvite(
  input: AcceptInviteInput
): Promise<OrganizationContext> {
  return runOrganizationOperation(
    "accept_invite",
    { userId: input.userId, email: input.userEmail, tokenLength: input.token.length },
    async (): Promise<OrganizationContext> => {
      const client = createAdminClient()
      const invite = await getPendingInviteByToken(client, input.token)
      const userEmail = normalizeOptionalEmail(input.userEmail)

      if (!userEmail || userEmail !== invite.email) {
        throw new OrganizationServiceError(
          "This invite must be accepted by the invited email address.",
          403
        )
      }

      await ensureProfile(client, input.userId, userEmail)

      const { data: membershipData, error: membershipError } = await client
        .from("organization_memberships")
        .upsert(
          {
            org_id: invite.organizationId,
            user_id: input.userId,
            role: invite.role,
            status: "active",
          },
          { onConflict: "org_id,user_id" }
        )
        .select("id,org_id,user_id,role,status,created_at,updated_at")
        .single()

      if (membershipError || !membershipData) {
        throw createSupabaseServiceError(membershipError, "Unable to accept invite.")
      }

      const { error: inviteError } = await client
        .from("invites")
        .update({
          status: "accepted",
          accepted_by: input.userId,
          accepted_at: new Date().toISOString(),
        })
        .eq("id", invite.id)
        .eq("status", "pending")

      if (inviteError) {
        throw createSupabaseServiceError(
          inviteError,
          "Unable to mark invite as accepted."
        )
      }

      await recordOrganizationAuditLog({
        organizationId: invite.organizationId,
        actorUserId: input.userId,
        action: "invite.accepted",
        targetType: "invite",
        targetId: invite.id,
        metadata: { email: invite.email, role: invite.role },
      })

      return {
        organization: await getOrganizationById(client, invite.organizationId),
        membership: mapMembership(membershipData as MembershipRow),
      }
    }
  )
}

/**
 * Updates a member's organization role.
 *
 * @param input - Actor, organization, membership, and target role.
 * @returns Updated membership.
 * @throws OrganizationServiceError when the actor lacks permission or the update is invalid.
 */
export async function updateMemberRole(
  input: UpdateMemberRoleInput
): Promise<OrganizationMembership> {
  return runOrganizationOperation(
    "update_member_role",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      role: input.role,
    },
    async (): Promise<OrganizationMembership> => {
      const client = createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        input.organizationId,
        input.actorUserId
      )

      if (!actorMembership || !canUpdateMemberRole(actorMembership.role)) {
        throw new OrganizationServiceError("You cannot update member roles.", 403)
      }

      if (!getAssignableOrganizationRoles().includes(input.role)) {
        throw new OrganizationServiceError("That role cannot be assigned.", 400)
      }

      const targetMembership = await getMembershipById(client, input.membershipId)

      if (targetMembership.organizationId !== input.organizationId) {
        throw new OrganizationServiceError("Member does not belong to this organization.", 404)
      }

      if (targetMembership.role === "owner_admin") {
        const ownerCount = await countActiveOwners(client, input.organizationId)

        if (ownerCount <= 1) {
          throw new OrganizationServiceError("The organization must keep one owner.", 400)
        }
      }

      const { data, error } = await client
        .from("organization_memberships")
        .update({ role: input.role })
        .eq("id", input.membershipId)
        .select("id,org_id,user_id,role,status,created_at,updated_at")
        .single()

      if (error || !data) {
        throw createSupabaseServiceError(error, "Unable to update member role.")
      }

      const updatedMembership = mapMembership(data as MembershipRow)

      await recordOrganizationAuditLog({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "membership.role_updated",
        targetType: "membership",
        targetId: input.membershipId,
        metadata: {
          previousRole: targetMembership.role,
          newRole: updatedMembership.role,
        },
      })

      return updatedMembership
    }
  )
}

async function runOrganizationOperation<T>(
  operationName: string,
  identifiers: Record<string, LogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("organization_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    if (error instanceof OrganizationServiceError) {
      console.warn("organization_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: error.statusCode,
        reason: error.message,
        ...identifiers,
      })
      throw error
    }

    const setupError = createOrganizationSetupError(error)

    if (setupError) {
      console.warn("organization_service_rejected", {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: setupError.statusCode,
        reason: setupError.message,
        ...identifiers,
      })
      throw setupError
    }

    console.error("organization_service_failed", {
      operationName,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "Unknown service error",
      ...identifiers,
    })
    throw new OrganizationServiceError("Organization service failed.", 500)
  }
}

async function recordOrganizationAuditLog(input: {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string
  metadata: AuditMetadata
}): Promise<void> {
  try {
    await recordAuditLog(input)
  } catch (error: unknown) {
    console.warn("organization_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
  }
}

async function ensureProfile(
  client: AdminClient,
  userId: string,
  email: string | null
): Promise<void> {
  const normalizedEmail = normalizeOptionalEmail(email)
  const profileInput: { id: string; email?: string } = { id: userId }

  if (normalizedEmail !== null) {
    profileInput.email = normalizedEmail
  }

  const { error } = await client.from("profiles").upsert(
    profileInput,
    { onConflict: "id" }
  )

  if (error) {
    throw createSupabaseServiceError(error, "Unable to save user profile.")
  }
}

async function getFirstActiveMembership(
  client: AdminClient,
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

async function getActiveMembership(
  client: AdminClient,
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

async function getMembershipById(
  client: AdminClient,
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

async function getOrganizationById(
  client: AdminClient,
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

async function getProfileByEmail(
  client: AdminClient,
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

async function listProfilesByUserIds(
  client: AdminClient,
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

async function getPendingInviteByToken(
  client: AdminClient,
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

async function countActiveOwners(
  client: AdminClient,
  organizationId: string
): Promise<number> {
  const { count, error } = await client
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("org_id", organizationId)
    .eq("role", "owner_admin")
    .eq("status", "active")

  if (error || count === null) {
    throw createSupabaseServiceError(
      error,
      "Unable to validate organization owners."
    )
  }

  return count
}

function mapOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapMembership(row: MembershipRow): OrganizationMembership {
  const role = parseOrganizationRole(row.role)
  const status = parseMembershipStatus(row.status)

  return {
    id: row.id,
    organizationId: row.org_id,
    userId: row.user_id,
    role,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapInvite(row: InviteRow): OrganizationInvite {
  const role = parseOrganizationRole(row.role)
  const status = parseInviteStatus(row.status)

  return {
    id: row.id,
    organizationId: row.org_id,
    email: row.email,
    role,
    token: row.token,
    status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

function parseOrganizationRole(value: string): OrganizationRole {
  if (!isOrganizationRole(value)) {
    throw new OrganizationServiceError("Database returned an unsupported role.", 500)
  }

  return value
}

function createOrganizationSetupError(error: unknown): OrganizationServiceError | null {
  if (!(error instanceof Error)) {
    return null
  }

  if (error.message.includes("Invalid admin Supabase environment")) {
    return new OrganizationServiceError(
      "Supabase server credentials are not configured.",
      500
    )
  }

  return null
}

function createSupabaseServiceError(
  error: unknown,
  fallbackMessage: string,
  fallbackStatusCode = 500
): OrganizationServiceError {
  const setupMessage = getSupabaseSetupFailureMessage(error)

  if (setupMessage) {
    return new OrganizationServiceError(setupMessage, 500)
  }

  return new OrganizationServiceError(fallbackMessage, fallbackStatusCode)
}

function getSupabaseSetupFailureMessage(error: unknown): string | null {
  const errorLike = getSupabaseErrorLike(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
    error instanceof Error ? error.message : null,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (!searchableMessage) {
    return null
  }

  if (
    searchableMessage.includes("invalid api key") ||
    searchableMessage.includes("provided api key")
  ) {
    return "Supabase server credentials are invalid. Re-copy SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and SUPABASE_SECRET_KEY from the Supabase dashboard."
  }

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("does not exist") ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return "Supabase database schema is not installed or exposed. Apply the Sprint 2 and Sprint 3 migrations."
  }

  if (
    searchableMessage.includes("permission denied for table") ||
    searchableMessage.includes("permission denied for schema")
  ) {
    return "Supabase table permissions are incomplete. Apply the latest migrations."
  }

  return null
}

function getSupabaseErrorLike(error: unknown): SupabaseErrorLike | null {
  if (!error || typeof error !== "object") {
    return null
  }

  return error as SupabaseErrorLike
}

function parseMembershipStatus(value: string): MembershipStatus {
  if (value === "active" || value === "disabled") {
    return value
  }

  throw new OrganizationServiceError("Database returned an unsupported membership status.", 500)
}

function parseInviteStatus(value: string): InviteStatus {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new OrganizationServiceError("Database returned an unsupported invite status.", 500)
}

function normalizeOrganizationName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ")

  if (normalizedName.length < 2 || normalizedName.length > 120) {
    throw new OrganizationServiceError(
      "Organization name must be between 2 and 120 characters.",
      400
    )
  }

  return normalizedName
}

function normalizeEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new OrganizationServiceError("Enter a valid email address.", 400)
  }

  return normalizedEmail
}

function normalizeOptionalEmail(email: string | null): string | null {
  if (!email) {
    return null
  }

  return normalizeEmail(email)
}

function createOrganizationSlug(name: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${baseSlug || "organization"}-${randomUUID().slice(0, 8)}`
}

function createInviteToken(): string {
  return randomUUID().replaceAll("-", "")
}
