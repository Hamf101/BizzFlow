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
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  createPublicFormLink,
  disablePublicFormLink,
} from "@/services/public-form-service"

class PublicLinkActionError extends Error {
  readonly statusCode = 403
}

// Who may manage a template's links is the service's to decide.
async function requireOrganizationId(userId: string): Promise<string> {
  const context = await getCurrentOrganizationContext(userId)

  if (!context) {
    throw new PublicLinkActionError("You do not have permission to manage public form links.")
  }

  return context.organization.id
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

    await createPublicFormLink({
      actorUserId: user.id,
      organizationId: await requireOrganizationId(user.id),
      templateId,
      expiresAt: expiresAt || null,
      maxSubmissions: maxSubmissionsRaw ? Number(maxSubmissionsRaw) : null,
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
  const templateId = getFormString(formData, "templateId")
  const linksPath = getPublicLinksPath(templateId)

  try {
    const user = await getAuthenticatedUser()

    await disablePublicFormLink({
      actorUserId: user.id,
      organizationId: await requireOrganizationId(user.id),
      templateId,
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
