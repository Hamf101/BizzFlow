"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getAuthenticatedUser } from "@/lib/auth"
import { runFormAction } from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  createInvite,
  OrganizationServiceError,
  revokeInvite,
  updateMemberAccess,
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

  await runFormAction({
    event: "create_invite_action",
    log: { organizationId },
    path: "/people",
    success: "invite_email_sent",
    // A conflict here means the address already belongs to an active member (a
    // pending invite is replaced, not rejected); the generic "this item
    // changed" prompt would not say so.
    failure: (error) =>
      error instanceof OrganizationServiceError && error.statusCode === 409
        ? "invite_already_member"
        : error instanceof OrganizationServiceError && error.statusCode === 502
          ? "invite_email_failed"
          : undefined,
    run: async () => {
      await createInvite({
        actorUserId: user.id,
        organizationId: parsed.data.organizationId,
        email: getFormString(formData, "email"),
        roleId: parsed.data.roleDefinitionId,
      })
      revalidatePath("/people")
    },
  })
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

  await runFormAction({
    event: "update_member_access_action",
    log: { membershipId: parsed.data.membershipId, organizationId: parsed.data.organizationId },
    path: "/people",
    success: "member_access_updated",
    run: async () => {
      const user = await getAuthenticatedUser()
      await updateMemberAccess({
        actorUserId: user.id,
        organizationId: parsed.data.organizationId,
        membershipId: parsed.data.membershipId,
        roleId: parsed.data.roleDefinitionId,
        workspaceDisplayName: parsed.data.workspaceDisplayName || null,
      })
      revalidatePath("/people")
      revalidatePath("/settings")
    },
  })
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

  await runFormAction({
    event: "revoke_invite_action",
    log: { organizationId },
    path: "/people",
    success: "invite_deleted",
    run: async () => {
      const user = await getAuthenticatedUser()
      await revokeInvite({ actorUserId: user.id, organizationId, inviteId })
      revalidatePath("/people")
    },
  })
}
