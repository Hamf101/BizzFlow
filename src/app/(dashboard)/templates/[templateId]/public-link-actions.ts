"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

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

const templateIdSchema = z.string().uuid()

export async function createPublicFormLinkAction(
  formData: FormData
): Promise<void> {
  const templateId = getFormString(formData, "templateId")
  const linksPath = getPublicLinksPath(templateId)
  const expiresAt = getFormString(formData, "expiresAt")
  const maxSubmissionsRaw = getFormString(formData, "maxSubmissions")

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership,
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

    revalidatePath(linksPath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: linksPath }))
    }

    redirect(
      buildFeedbackRedirect(linksPath, getActionErrorFeedbackCode(error))
    )
  }

  redirect(buildFeedbackRedirect(linksPath, "public_link_created"))
}

export async function disablePublicFormLinkAction(
  formData: FormData
): Promise<void> {
  const linkId = getFormString(formData, "linkId")
  const linksPath = getPublicLinksPath(getFormString(formData, "templateId"))

  try {
    const user = await getAuthenticatedUser()
    const context = await getCurrentOrganizationContext(user.id)

    if (
      !context ||
      !canPerformOrganizationAction(
        context.membership,
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

    revalidatePath(linksPath)
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: linksPath }))
    }

    redirect(
      buildFeedbackRedirect(linksPath, getActionErrorFeedbackCode(error))
    )
  }

  redirect(buildFeedbackRedirect(linksPath, "public_link_disabled"))
}

/**
 * Chooses where a public-link action lands afterwards: the template's public
 * links, or the template library when the form names no template id. Only a
 * real id may shape the path, so a crafted value cannot steer the redirect.
 *
 * @param templateId - Untrusted template id from the form.
 * @returns A path inside the templates area.
 */
function getPublicLinksPath(templateId: string): string {
  return templateIdSchema.safeParse(templateId).success
    ? `/templates/${templateId}/links`
    : "/templates"
}
