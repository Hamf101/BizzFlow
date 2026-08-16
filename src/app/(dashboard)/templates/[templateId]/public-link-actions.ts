"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  createPublicFormLink,
  disablePublicFormLink,
  PublicFormServiceError,
} from "@/services/public-form-service"

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
      redirect(
        buildRedirect(templatePath, {
          error: "You do not have permission to manage public form links.",
        })
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

    const message =
      error instanceof PublicFormServiceError
        ? error.message
        : "Unable to create public form link."

    redirect(buildRedirect(templatePath, { error: message }))
  }

  redirect(buildRedirect(templatePath, { message: "Public form link created." }))
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
      redirect(
        buildRedirect(templatePath, {
          error: "You do not have permission to manage public form links.",
        })
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

    const message =
      error instanceof PublicFormServiceError
        ? error.message
        : "Unable to disable public form link."

    redirect(buildRedirect(templatePath, { error: message }))
  }

  redirect(buildRedirect(templatePath, { message: "Public form link disabled." }))
}
