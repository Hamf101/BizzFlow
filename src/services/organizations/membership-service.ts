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
