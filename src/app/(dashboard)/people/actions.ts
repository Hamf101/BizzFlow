"use server"

import { redirect } from "next/navigation"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { isOrganizationRole } from "@/lib/permissions"
import {
  createInvite,
  OrganizationServiceError,
  updateMemberRole,
} from "@/services/organization-service"

/**
 * Handles staff invite creation from the People page.
 *
 * @param formData - Submitted invite form data.
 * @returns Never returns; redirects to People with status.
 */
export async function createInviteAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const role = getFormString(formData, "role")

  if (!isOrganizationRole(role)) {
    redirect(buildRedirect("/people", { error: "Choose a valid role." }))
  }

  // Both calls reject by throwing (a redirect), so they must stay outside the
  // try that maps invite failures — a catch would swallow the redirect signal.
  const user = await loadAuthenticatedPageUser("/people")
  await enforceOutboundEmailRateLimit({
    userId: user.id,
    redirectPath: "/people",
  })

  try {
    await createInvite({
      actorUserId: user.id,
      organizationId,
      email: getFormString(formData, "email"),
      role,
    })
  } catch (error: unknown) {
    const logContext = {
      organizationId,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    }

    if (error instanceof OrganizationServiceError) {
      console.warn("create_invite_action_failed", logContext)
    } else {
      console.error("create_invite_action_failed", logContext)
    }

    redirect(
      buildRedirect("/people", {
        error: getActionErrorMessage(error, "Unable to create invite."),
      })
    )
  }

  redirect(buildRedirect("/people", { message: "Invite email sent." }))
}

/**
 * Handles member role updates from the People page.
 *
 * @param formData - Submitted role update form data.
 * @returns Never returns; redirects to People with status.
 */
export async function updateMemberRoleAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const membershipId = getFormString(formData, "membershipId")
  const role = getFormString(formData, "role")

  if (!isOrganizationRole(role)) {
    redirect(buildRedirect("/people", { error: "Choose a valid role." }))
  }

  try {
    const user = await getAuthenticatedUser()
    await updateMemberRole({
      actorUserId: user.id,
      organizationId,
      membershipId,
      role,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/people" }))
    }

    const logContext = {
      organizationId,
      membershipId,
      reason: error instanceof Error ? error.message : "Unknown role update error",
    }

    if (error instanceof OrganizationServiceError) {
      console.warn("update_member_role_action_failed", logContext)
    } else {
      console.error("update_member_role_action_failed", logContext)
    }

    redirect(
      buildRedirect("/people", {
        error: getActionErrorMessage(error, "Unable to update member role."),
      })
    )
  }

  redirect(buildRedirect("/people", { message: "Member role updated." }))
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof OrganizationServiceError) {
    return error.message
  }

  return fallback
}
