import {
  canInviteMembers,
  getAssignableOrganizationRoles,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  InviteEmailServiceError,
  sendInviteEmail,
} from "@/services/invite-email-service"
import type {
  AcceptInviteInput,
  CreateInviteInput,
  CreateInviteResult,
  OrganizationMutationDeps,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  acceptOrganizationInvite,
  createPendingInviteRecord,
  getActiveMembership,
  getOrganizationById,
  getPendingInviteByToken,
  getProfileByEmail,
  revokePendingInvitesForEmail,
  revokeUndeliveredInvite,
} from "@/services/organizations/repository"
import {
  createInviteToken,
  normalizeEmail,
  normalizeOptionalEmail,
  recordOrganizationAuditLog,
  runOrganizationOperation,
} from "@/services/organizations/shared"
import type {
  InvitePreview,
  OrganizationContext,
} from "@/types/organization"

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Creates a pending invite for an organization.
 *
 * @param input - Actor, organization, email, and role for the invite.
 * @returns The invite, and whether the notification email actually went out.
 * @throws OrganizationServiceError when the actor lacks permission or writes fail.
 */
export async function createInvite(
  input: CreateInviteInput
): Promise<CreateInviteResult> {
  return runOrganizationOperation(
    "create_invite",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      role: input.role,
    },
    async (): Promise<CreateInviteResult> => {
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
        throw new OrganizationServiceError(
          "That role cannot be assigned by invite.",
          400
        )
      }

      const email = normalizeEmail(input.email)
      const organization = await getOrganizationById(
        client,
        input.organizationId
      )
      const existingProfile = await getProfileByEmail(client, email)

      if (existingProfile) {
        const existingMembership = await getActiveMembership(
          client,
          input.organizationId,
          existingProfile.id
        )

        if (existingMembership) {
          throw new OrganizationServiceError(
            "That user is already a member.",
            409
          )
        }
      }

      await revokePendingInvitesForEmail(client, input.organizationId, email)

      const invite = await createPendingInviteRecord(client, {
        organizationId: input.organizationId,
        email,
        role: input.role,
        token: createInviteToken(),
        invitedBy: input.actorUserId,
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS).toISOString(),
      })

      // Email is how an invite is usually delivered, not what makes it valid.
      // The token is already persisted, scoped, expiring, and single-use, so a
      // provider outage or an unverified sending domain must not destroy the
      // invite — the People page shows the link for the manager to share
      // directly. Revoking here used to make a misconfigured Resend account
      // look like a broken invite feature.
      let emailDelivered = true
      let emailFailureReason: string | null = null

      try {
        await sendInviteEmail({
          inviteId: invite.id,
          organizationName: organization.name,
          recipientEmail: invite.email,
          token: invite.token,
        })
      } catch (error: unknown) {
        if (!(error instanceof InviteEmailServiceError)) {
          await revokeUndeliveredInvite(client, invite.id, input.organizationId)
          throw error
        }

        emailDelivered = false
        emailFailureReason = error.message

        console.warn("invite_created_without_email", {
          inviteId: invite.id,
          organizationId: input.organizationId,
          reason: error.message,
        })
      }

      await recordOrganizationAuditLog({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "invite.created",
        targetType: "invite",
        targetId: invite.id,
        metadata: {
          email: invite.email,
          role: invite.role,
          emailDelivered,
        },
      })

      return { invite, emailDelivered, emailFailureReason }
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
      const organization = await getOrganizationById(
        client,
        invite.organizationId
      )

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
 * @param deps - Optional database and audit dependencies for tests.
 * @returns Organization context after accepting the invite.
 * @throws OrganizationServiceError when the invite is invalid or writes fail.
 */
export async function acceptInvite(
  input: AcceptInviteInput,
  deps: OrganizationMutationDeps = {}
): Promise<OrganizationContext> {
  return runOrganizationOperation(
    "accept_invite",
    { userId: input.userId, tokenLength: input.token.length },
    async (): Promise<OrganizationContext> => {
      const client = deps.client ?? createAdminClient()
      const invite = await getPendingInviteByToken(client, input.token)
      const userEmail = normalizeOptionalEmail(input.userEmail)

      if (!userEmail || userEmail !== invite.email) {
        throw new OrganizationServiceError(
          "This invite must be accepted by the invited email address.",
          403
        )
      }

      const acceptedMembershipId = await acceptOrganizationInvite(client, {
        inviteId: invite.id,
        token: input.token,
        userId: input.userId,
        userEmail,
      })

      const membership = await getActiveMembership(
        client,
        invite.organizationId,
        input.userId
      )

      if (
        !membership ||
        membership.id !== acceptedMembershipId ||
        membership.role !== invite.role
      ) {
        throw new OrganizationServiceError(
          "Unable to verify accepted organization membership.",
          500
        )
      }

      await recordOrganizationAuditLog(
        {
          organizationId: invite.organizationId,
          actorUserId: input.userId,
          action: "invite.accepted",
          targetType: "invite",
          targetId: invite.id,
          metadata: { email: invite.email, role: invite.role },
        },
        deps.recordAuditLog
      )

      return {
        organization: await getOrganizationById(
          client,
          invite.organizationId
        ),
        membership,
      }
    }
  )
}
