import {
  canAssignOrganizationRole,
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
  RevokeInviteInput,
} from "@/services/organizations/contracts"
import { OrganizationServiceError } from "@/services/organizations/errors"
import {
  acceptOrganizationInvite,
  createPendingInviteRecord,
  getActiveMembership,
  getOrganizationById,
  getOrganizationRoleRecord,
  getPendingInviteByToken,
  getProfileByEmail,
  revokePendingInvitesForEmail,
  revokeManageableInvite,
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
  OrganizationInvite,
} from "@/types/organization"

const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Revokes an active or expired invite for an organization.
 *
 * @param input - Actor, tenant, and invite identifiers.
 * @param deps - Optional database and audit dependencies for tests.
 * @returns The revoked invite.
 * @throws OrganizationServiceError when permission or tenant checks fail.
 */
export async function revokeInvite(
  input: RevokeInviteInput,
  deps: OrganizationMutationDeps = {}
): Promise<OrganizationInvite> {
  return runOrganizationOperation(
    "revoke_invite",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      inviteId: input.inviteId,
    },
    async (): Promise<OrganizationInvite> => {
      const client = deps.client ?? createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        input.organizationId,
        input.actorUserId
      )

      if (!actorMembership || !canInviteMembers(actorMembership)) {
        throw new OrganizationServiceError("You cannot delete invites.", 403)
      }

      const invite = await revokeManageableInvite(
        client,
        input.organizationId,
        input.inviteId
      )

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "invite.revoked",
          targetType: "invite",
          targetId: input.inviteId,
          metadata: {},
        },
        deps.recordAuditLog
      )

      return invite
    }
  )
}

/**
 * Creates a pending invite for an organization.
 *
 * @param input - Actor, organization, email, and role for the invite.
 * @returns The invite, and whether the notification email actually went out.
 * @throws OrganizationServiceError when the actor lacks permission or writes fail.
 */
export async function createInvite(
  input: CreateInviteInput,
  deps: OrganizationMutationDeps = {}
): Promise<CreateInviteResult> {
  return runOrganizationOperation(
    "create_invite",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      roleId: input.roleId,
    },
    async (): Promise<CreateInviteResult> => {
      const client = deps.client ?? createAdminClient()
      const actorMembership = await getActiveMembership(
        client,
        input.organizationId,
        input.actorUserId
      )

      if (!actorMembership || !canInviteMembers(actorMembership)) {
        throw new OrganizationServiceError("You cannot invite members.", 403)
      }

      const roleDefinition = await getOrganizationRoleRecord(
        client,
        input.organizationId,
        input.roleId
      )

      if (roleDefinition.systemKey === "owner_admin") {
        throw new OrganizationServiceError(
          "That role cannot be assigned by invite.",
          400
        )
      }

      const role = roleDefinition.systemKey ?? "staff"

      if (!getAssignableOrganizationRoles().includes(role)) {
        throw new OrganizationServiceError(
          "That role cannot be assigned by invite.",
          400
        )
      }

      if (!canAssignOrganizationRole(actorMembership, roleDefinition)) {
        throw new OrganizationServiceError(
          "You can only invite people to roles within your own access.",
          403
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
        role,
        roleDefinitionId: roleDefinition.id,
        token: deps.createInviteToken?.() ?? createInviteToken(),
        invitedBy: input.actorUserId,
        expiresAt: new Date(
          (deps.now?.() ?? new Date()).getTime() + INVITE_LIFETIME_MS
        ).toISOString(),
      })

      // Email is how an invite is usually delivered, not what makes it valid.
      // The token is already persisted, scoped, expiring, and single-use, so a
      // provider outage or an unverified sending domain must not destroy the
      // invite — the People page shows the link for the manager to share
      // directly. Revoking here used to make a misconfigured email provider
      // look like a broken invite feature.
      let emailDelivered = true
      let emailFailureReason: string | null = null

      try {
        await (deps.sendInviteEmail ?? sendInviteEmail)({
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

      await recordOrganizationAuditLog(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "invite.created",
          targetType: "invite",
          targetId: invite.id,
          metadata: {
            email: invite.email,
            role: invite.role,
            roleDefinitionId: invite.roleDefinitionId ?? null,
            emailDelivered,
          },
        },
        deps.recordAuditLog
      )

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
        roleName: invite.roleName,
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

      await requireInviterAuthority(client, invite)

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
        membership.roleDefinitionId !== invite.roleDefinitionId
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

/**
 * Opens an account for someone joining through an invite. The invite reached
 * their inbox, which proves the address just as a confirmation email would, so
 * the account starts confirmed and they can join straight away. The address is
 * always the invite's own, never one typed in.
 *
 * @param input - The invite token and the password they chose.
 * @param deps - Optional database client for tests.
 * @returns The invited address, and whether an account already used it.
 * @throws OrganizationServiceError 404 for an invite that is gone, 400 for a password the provider refuses.
 */
export async function createInvitedAccount(
  input: { password: string; token: string },
  deps: Pick<OrganizationMutationDeps, "client"> = {}
): Promise<{ email: string; existing: boolean }> {
  return runOrganizationOperation(
    "create_invited_account",
    { tokenLength: input.token.length },
    async () => {
      const client = deps.client ?? createAdminClient()
      const invite = await getPendingInviteByToken(client, input.token)
      const { error } = await client.auth.admin.createUser({
        email: invite.email,
        email_confirm: true,
        password: input.password,
      })

      if (error?.code === "email_exists") {
        return { email: invite.email, existing: true }
      }

      if (error?.code === "weak_password") {
        throw new OrganizationServiceError("Choose a longer or less common password.", 400)
      }

      if (error) {
        throw new OrganizationServiceError("Unable to create your account.", 500)
      }

      return { email: invite.email, existing: false }
    }
  )
}

/**
 * Confirms the invite's creator could still grant it today, so narrowing or
 * removing someone's access also withdraws the invitations they sent.
 *
 * @param client - Trusted Supabase client.
 * @param invite - Pending invite being accepted.
 * @throws OrganizationServiceError when the inviter no longer has that authority.
 */
async function requireInviterAuthority(
  client: NonNullable<OrganizationMutationDeps["client"]>,
  invite: OrganizationInvite
): Promise<void> {
  const inviter = invite.invitedBy
    ? await getActiveMembership(client, invite.organizationId, invite.invitedBy)
    : null
  const roleDefinition =
    inviter && invite.roleDefinitionId && canInviteMembers(inviter)
      ? await getOrganizationRoleRecord(
          client,
          invite.organizationId,
          invite.roleDefinitionId
        )
      : null

  if (
    !inviter ||
    !roleDefinition ||
    !canAssignOrganizationRole(inviter, roleDefinition)
  ) {
    throw new OrganizationServiceError(
      "This invite is no longer valid. Ask for a new invite.",
      403
    )
  }
}
