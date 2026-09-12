"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
  type ActionFeedbackCode,
} from "@/lib/action-result"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  createInvite,
  OrganizationServiceError,
  revokeInvite,
  updateMemberAccess,
  updateProfilePhone,
} from "@/services/organization-service"

const inviteSchema = z.object({
  organizationId: z.string().uuid(),
  roleDefinitionId: z.string().uuid(),
})
const memberAccessSchema = z.object({
  organizationId: z.string().uuid(),
  membershipId: z.string().uuid(),
  roleDefinitionId: z.string().uuid(),
  workspaceDisplayName: z.string().max(120).trim(),
})

/**
 * Handles staff invite creation from the People page.
 *
 * @param formData - Submitted invite form data.
 * @returns Never returns; redirects to People with status.
 */
export async function createInviteAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const parsed = inviteSchema.safeParse({
    organizationId,
    roleDefinitionId: getFormString(formData, "roleDefinitionId"),
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect("/people", "invalid_input"))
  }

  // Both calls reject by throwing (a redirect), so they must stay outside the
  // try that maps invite failures — a catch would swallow the redirect signal.
  const user = await loadAuthenticatedPageUser("/people")
  await enforceOutboundEmailRateLimit({
    userId: user.id,
    redirectPath: "/people",
  })

  let successCode: ActionFeedbackCode = "invite_email_sent"

  try {
    const result = await createInvite({
      actorUserId: user.id,
      organizationId: parsed.data.organizationId,
      email: getFormString(formData, "email"),
      roleId: parsed.data.roleDefinitionId,
    })

    if (!result.emailDelivered) {
      successCode = "invite_created_email_failed"
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
      buildFeedbackRedirect("/people", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/people")
  redirect(buildFeedbackRedirect("/people", successCode))
}

/**
 * Handles workspace display-name and role updates from the People page.
 *
 * @param formData - Submitted role update form data.
 * @returns Never returns; redirects to People with status.
 */
export async function updateMemberAccessAction(formData: FormData): Promise<void> {
  const parsed = memberAccessSchema.safeParse({
    organizationId: getFormString(formData, "organizationId"),
    membershipId: getFormString(formData, "membershipId"),
    roleDefinitionId: getFormString(formData, "roleDefinitionId"),
    workspaceDisplayName: getFormString(formData, "workspaceDisplayName"),
  })

  if (!parsed.success) {
    redirect(buildFeedbackRedirect("/people", "invalid_input"))
  }

  try {
    const user = await getAuthenticatedUser()
    await updateMemberAccess({
      actorUserId: user.id,
      organizationId: parsed.data.organizationId,
      membershipId: parsed.data.membershipId,
      roleId: parsed.data.roleDefinitionId,
      workspaceDisplayName: parsed.data.workspaceDisplayName || null,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/people" }))
    }

    const logContext = {
      organizationId: parsed.data.organizationId,
      membershipId: parsed.data.membershipId,
      reason: error instanceof Error ? error.message : "Unknown member access update error",
    }

    if (error instanceof OrganizationServiceError) {
      console.warn("update_member_access_action_failed", logContext)
    } else {
      console.error("update_member_access_action_failed", logContext)
    }

    redirect(
      buildFeedbackRedirect("/people", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/people")
  revalidatePath("/settings")
  redirect(buildFeedbackRedirect("/people", "member_access_updated"))
}

/**
 * Handles soft deletion of an active or expired organization invite.
 *
 * @param formData - Submitted tenant and invite identifiers.
 * @returns Never returns; redirects to People with status.
 */
export async function revokeInviteAction(formData: FormData): Promise<void> {
  const organizationId = getFormString(formData, "organizationId")
  const inviteId = getFormString(formData, "inviteId")

  try {
    const user = await getAuthenticatedUser()
    await revokeInvite({
      actorUserId: user.id,
      organizationId,
      inviteId,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/people" }))
    }

    redirect(
      buildFeedbackRedirect("/people", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/people")
  redirect(buildFeedbackRedirect("/people", "invite_deleted"))
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
      buildFeedbackRedirect("/people", getActionErrorFeedbackCode(error))
    )
  }

  revalidatePath("/people")
  redirect(buildFeedbackRedirect("/people", "changes_saved"))
}
