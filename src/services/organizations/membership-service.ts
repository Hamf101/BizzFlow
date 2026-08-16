import {
  canInviteMembers,
  canUpdateMemberRole,
  getAssignableOrganizationRoles,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import type {
  OrganizationMutationDeps,
  OrganizationPeople,
  ProfileRow,
  UpdateMemberRoleInput,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  getActiveMembership,
  getMembershipById,
  listActiveMemberships,
  listPendingInvites,
  listProfilesByUserIds,
  updateOrganizationMemberRole,
} from "@/services/organizations/repository"
import {
  recordOrganizationAuditLog,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import type {
  OrganizationMember,
  OrganizationMembership,
} from "@/types/organization"

/**
 * Loads organization members and pending invites for the People page.
 *
 * @param userId - Authenticated Supabase user id.
 * @param organizationId - Organization id to load.
 * @param deps - Optional database dependency for tests.
 * @returns Members and pending invites visible to the user.
 * @throws OrganizationServiceError when the user lacks access or reads fail.
 */
export async function listOrganizationPeople(
  userId: string,
  organizationId: string,
  deps: OrganizationMutationDeps = {}
): Promise<OrganizationPeople> {
  return runOrganizationOperation(
    "list_organization_people",
    { userId, organizationId },
    async (): Promise<OrganizationPeople> => {
      const client = deps.client ?? createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        organizationId,
        userId
      )

      if (!actorMembership) {
        throw new OrganizationServiceError(
          "You do not have access to this organization.",
          403
        )
      }

      const memberships = await listActiveMemberships(client, organizationId)
      const profiles = await listProfilesByUserIds(
        client,
        memberships.map(
          (membership: OrganizationMembership) => membership.userId
        )
      )
      const profileById = new Map(
        profiles.map((profile: ProfileRow) => [profile.id, profile])
      )

      return {
        members: memberships.map(
          (membership: OrganizationMembership): OrganizationMember => {
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
          }
        ),
        pendingInvites: canInviteMembers(actorMembership.role)
          ? await listPendingInvites(client, organizationId)
          : [],
      }
    }
  )
}

/**
 * Updates a member's organization role.
 *
 * @param input - Actor, organization, membership, and target role.
 * @param deps - Optional database and audit dependencies for tests.
 * @returns Updated membership.
 * @throws OrganizationServiceError when the actor lacks permission or the update is invalid.
 */
export async function updateMemberRole(
  input: UpdateMemberRoleInput,
  deps: OrganizationMutationDeps = {}
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
      const client = deps.client ?? createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        input.organizationId,
        input.actorUserId
      )

      if (!actorMembership || !canUpdateMemberRole(actorMembership.role)) {
        throw new OrganizationServiceError(
          "You cannot update member roles.",
          403
        )
      }

      if (!getAssignableOrganizationRoles().includes(input.role)) {
        throw new OrganizationServiceError(
          "That role cannot be assigned.",
          400
        )
      }

      const targetMembership = await getMembershipById(
        client,
        input.membershipId
      )

      if (targetMembership.organizationId !== input.organizationId) {
        throw new OrganizationServiceError(
          "Member does not belong to this organization.",
          404
        )
      }

      await updateOrganizationMemberRole(client, {
        organizationId: input.organizationId,
        membershipId: input.membershipId,
        actorUserId: input.actorUserId,
        role: input.role,
      })

      const updatedMembership = await getMembershipById(
        client,
        input.membershipId
      )

      if (
        updatedMembership.organizationId !== input.organizationId ||
        updatedMembership.role !== input.role
      ) {
        throw new OrganizationServiceError(
          "Unable to verify the updated member role.",
          500
        )
      }

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "membership.role_updated",
          targetType: "membership",
          targetId: input.membershipId,
          metadata: {
            previousRole: targetMembership.role,
            newRole: updatedMembership.role,
          },
        },
        deps.recordAuditLog
      )

      return updatedMembership
    }
  )
}

export type UpdateProfileInput = {
  actorUserId: string
  displayName: string | null
  phoneNumber: string | null
}

export async function updateProfile(
  input: UpdateProfileInput,
  deps: OrganizationMutationDeps = {}
): Promise<void> {
  return runOrganizationOperation(
    "update_profile",
    { userId: input.actorUserId },
    async (): Promise<void> => {
      const client = deps.client ?? createAdminClient()
      const phone = input.phoneNumber?.trim() || null
      const name = input.displayName?.trim() || null

      if (phone !== null && !/^\+[1-9]\d{1,14}$/.test(phone)) {
        throw new OrganizationServiceError(
          "Phone number must be in valid E.164 format (e.g. +14155552671).",
          400
        )
      }

      const { error } = await client
        .from("profiles")
        .update({ 
          full_name: name,
          phone_number: phone, 
          updated_at: new Date().toISOString() 
        })
        .eq("id", input.actorUserId)

      if (error) {
        throw new OrganizationServiceError("Unable to update profile.", 500)
      }
    }
  )
}

export type UpdateNotificationPreferencesInput = {
  actorUserId: string
  organizationId: string
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

/** Profile and notification settings shown on the settings page. */
export type MemberSettings = {
  displayName: string | null
  phoneNumber: string | null
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

type MemberSettingsProfileRow = {
  full_name: string | null
  phone_number: string | null
}

type MemberSettingsMembershipRow = {
  email_notifications_enabled: boolean | null
  sms_notifications_enabled: boolean | null
}

/**
 * Loads the actor's own profile and notification preferences for the settings page.
 *
 * Both reads are scoped to the actor and the organization, so a member can only
 * ever load their own settings.
 *
 * @param input - Actor user id and the organization whose membership to read.
 * @param deps - Optional database dependency for tests.
 * @returns The actor's display name, phone number, and notification toggles.
 * @throws OrganizationServiceError when the membership is missing or reads fail.
 */
export async function getMemberSettings(
  input: { actorUserId: string; organizationId: string },
  deps: OrganizationMutationDeps = {}
): Promise<MemberSettings> {
  return runOrganizationOperation(
    "get_member_settings",
    { userId: input.actorUserId, organizationId: input.organizationId },
    async (): Promise<MemberSettings> => {
      const client = deps.client ?? createAdminClient()

      const [profileResult, membershipResult] = await Promise.all([
        client
          .from("profiles")
          .select("full_name,phone_number")
          .eq("id", input.actorUserId)
          .maybeSingle(),
        client
          .from("organization_memberships")
          .select("email_notifications_enabled,sms_notifications_enabled")
          .eq("org_id", input.organizationId)
          .eq("user_id", input.actorUserId)
          .eq("status", "active")
          .maybeSingle(),
      ])

      if (profileResult.error || membershipResult.error) {
        throw new OrganizationServiceError("Unable to load settings.", 500)
      }

      if (!membershipResult.data) {
        throw new OrganizationServiceError(
          "You do not have access to this organization.",
          403
        )
      }

      const profile = (profileResult.data ?? null) as MemberSettingsProfileRow | null
      const membership = membershipResult.data as MemberSettingsMembershipRow

      return {
        displayName: profile?.full_name ?? null,
        phoneNumber: profile?.phone_number ?? null,
        emailNotificationsEnabled: membership.email_notifications_enabled ?? true,
        smsNotificationsEnabled: membership.sms_notifications_enabled ?? true,
      }
    }
  )
}

export async function updateNotificationPreferences(
  input: UpdateNotificationPreferencesInput,
  deps: OrganizationMutationDeps = {}
): Promise<void> {
  return runOrganizationOperation(
    "update_notification_preferences",
    { userId: input.actorUserId, organizationId: input.organizationId },
    async (): Promise<void> => {
      const client = deps.client ?? createAdminClient()
      
      const { error } = await client
        .from("organization_memberships")
        .update({ 
          email_notifications_enabled: input.emailNotificationsEnabled,
          sms_notifications_enabled: input.smsNotificationsEnabled,
          updated_at: new Date().toISOString()
        })
        .eq("org_id", input.organizationId)
        .eq("user_id", input.actorUserId)

      if (error) {
        throw new OrganizationServiceError("Unable to update notification preferences.", 500)
      }
    }
  )
}

/** Input for updating a profile's phone number. */
export type UpdateProfilePhoneInput = {
  actorUserId: string
  phoneNumber: string | null
}

/**
 * Updates an actor profile's phone number in E.164 format.
 *
 * @param input - Actor user ID and phone number.
 * @param deps - Optional database dependencies.
 * @throws OrganizationServiceError when format validation or write fails.
 */
export async function updateProfilePhone(
  input: UpdateProfilePhoneInput,
  deps: OrganizationMutationDeps = {}
): Promise<void> {
  return runOrganizationOperation(
    "update_profile_phone",
    { userId: input.actorUserId },
    async (): Promise<void> => {
      const client = deps.client ?? createAdminClient()
      const phone = input.phoneNumber?.trim() || null

      if (phone !== null && !/^\+[1-9]\d{1,14}$/.test(phone)) {
        throw new OrganizationServiceError(
          "Phone number must be in valid E.164 format (e.g. +14155552671).",
          400
        )
      }

      const { error } = await client
        .from("profiles")
        .update({ phone_number: phone, updated_at: new Date().toISOString() })
        .eq("id", input.actorUserId)

      if (error) {
        throw new OrganizationServiceError("Unable to update profile phone number.", 500)
      }
    }
  )
}
