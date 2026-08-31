"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  createPublicFormLink,
  disablePublicFormLink,
} from "@/services/public-form-service"

class PublicLinkActionError extends Error {
  readonly statusCode = 403
}

export async function createPublicFormLinkAction(
  formData: FormData
): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const templatePath = "/templates"
  const expiresAt = getFormString(formData, "expiresAt")
  const maxSubmissionsRaw = getFormString(formData, "maxSubmissions")

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership.role,
        "templates:manage"
      )
    ) {
      throw new PublicLinkActionError(
        "You do not have permission to manage public form links."
      )
    }

    const maxSubmissions = maxSubmissionsRaw
      ? Number.parseInt(maxSubmissionsRaw, 10)
      : null

    await createPublicFormLink({
      actorUserId: user.id,
      organizationId: context.organization.id,
      templateId,
      expiresAt: expiresAt || null,
      maxSubmissions: Number.isNaN(maxSubmissions) ? null : maxSubmissions,
    })

    revalidatePath(templatePath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: templatePath }))
    }

    redirect(
      buildFeedbackRedirect(templatePath, getActionErrorFeedbackCode(error))
    )
  }

  redirect(buildFeedbackRedirect(templatePath, "public_link_created"))
}

export async function disablePublicFormLinkAction(
  formData: FormData
): Promise<void> {
  const linkId = getFormString(formData, "linkId")
  const templatePath = "/templates"

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership.role,
        "templates:manage"
      )
    ) {
      throw new PublicLinkActionError(
        "You do not have permission to manage public form links."
      )
    }

    await disablePublicFormLink({
      actorUserId: user.id,
      organizationId: context.organization.id,
      linkId,
    })

    revalidatePath(templatePath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: templatePath }))
    }

    redirect(
      buildFeedbackRedirect(templatePath, getActionErrorFeedbackCode(error))
    )
  }

  redirect(buildFeedbackRedirect(templatePath, "public_link_disabled"))
}
