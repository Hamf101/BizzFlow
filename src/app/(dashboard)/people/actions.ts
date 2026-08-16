"use server"

import { revalidatePath } from "next/cache"
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
  updateProfilePhone,
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

  let successMessage = "Invite email sent."

  try {
    const result = await createInvite({
      actorUserId: user.id,
      organizationId,
      email: getFormString(formData, "email"),
      role,
    })

    if (!result.emailDelivered) {
      successMessage =
        "Invite created, but the email could not be sent. " +
        "Copy its link below and share it directly. " +
        (result.emailFailureReason ?? "")
    }
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

  revalidatePath("/people")
  redirect(buildRedirect("/people", { message: successMessage }))
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

  revalidatePath("/people")
  redirect(buildRedirect("/people", { message: "Member role updated." }))
}

/**
 * Handles profile phone number updates.
 *
 * @param formData - Submitted phone form data.
 * @returns Never returns; redirects to People with status.
 */
export async function updateProfilePhoneAction(formData: FormData): Promise<void> {
  const phoneNumber = getFormString(formData, "phoneNumber")

  try {
    const user = await getAuthenticatedUser()
    await updateProfilePhone({
      actorUserId: user.id,
      phoneNumber: phoneNumber === "" ? null : phoneNumber,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/people" }))
    }

    redirect(
      buildRedirect("/people", {
        error: getActionErrorMessage(error, "Unable to update phone number."),
      })
    )
  }

  revalidatePath("/people")
  redirect(buildRedirect("/people", { message: "Phone number updated." }))
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof OrganizationServiceError) {
    return error.message
  }

  return fallback
}
