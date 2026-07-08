"use server"

import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  acceptInvite,
  OrganizationServiceError,
} from "@/services/organization-service"

/**
 * Handles accepting a pending organization invite.
 *
 * @param formData - Submitted invite acceptance form data.
 * @returns Never returns; redirects after acceptance or failure.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = getFormString(formData, "token")
  const invitePath = `/accept-invite/${encodeURIComponent(token)}`

  if (!token) {
    redirect(buildRedirect("/login", { error: "Invite token is missing." }))
  }

  try {
    const user = await getAuthenticatedUser()
    await acceptInvite({
      userId: user.id,
      userEmail: user.email,
      token,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: invitePath }))
    }

    const logContext = {
      tokenLength: token.length,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    }

    if (error instanceof OrganizationServiceError) {
      console.warn("accept_invite_action_failed", logContext)
    } else {
      console.error("accept_invite_action_failed", logContext)
    }

    redirect(
      buildRedirect(invitePath, {
        error: getActionErrorMessage(error, "Unable to accept invite."),
      })
    )
  }

  redirect(buildRedirect("/dashboard", { message: "Invite accepted." }))
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof OrganizationServiceError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
