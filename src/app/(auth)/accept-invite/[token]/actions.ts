"use server"

import { buildFeedbackRedirect } from "@/lib/action-result"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import {
  acceptInviteLink,
  type InviteLink,
  joinInviteLinkWithPassword,
  switchInviteLinkAccount,
} from "@/lib/invite-link"
import {
  acceptInvite,
  createInvitedAccount,
  getInvitePreview,
  OrganizationServiceError,
} from "@/services/organization-service"

/**
 * Joins the workspace as the account already signed in.
 *
 * @param formData - The invite token.
 * @returns Never returns; redirects to the dashboard or back with the reason.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  await acceptInviteLink(formData, workspaceInvite)
}

/**
 * Joins the workspace in one step from a signed-out browser: opens an account
 * for someone new, or signs in someone who already has one, then accepts.
 *
 * @param formData - The invite token, whether they have an account, a password (twice when new), and someone new's name and optional phone.
 * @returns Never returns; redirects to the dashboard or back with the reason.
 */
export async function joinWithPasswordAction(formData: FormData): Promise<void> {
  await joinInviteLinkWithPassword(formData, workspaceInvite)
}

/**
 * Signs out an account the invite isn't for, so its owner can join.
 *
 * @param formData - The invite token.
 * @returns Never returns; reopens the invite.
 */
export async function switchInviteAccountAction(formData: FormData): Promise<void> {
  await switchInviteLinkAccount(formData, workspaceInvite)
}

function workspaceInvite(token: string): InviteLink {
  return {
    path: buildAcceptInvitePath(token),
    event: "accept_invite",
    openAccount: (password) => createInvitedAccount({ password, token }),
    findEmail: async () => (await getInvitePreview(token)).email,
    accept: async (user) => {
      await acceptInvite({ token, userEmail: user.email, userId: user.id })
      return buildFeedbackRedirect("/dashboard", "invite_accepted")
    },
    explain: (error) =>
      error instanceof OrganizationServiceError
        ? error.statusCode === 404
          ? "This invite has expired or was already used."
          : error.message
        : undefined,
    fallback: "Unable to join the workspace. Try again.",
  }
}
