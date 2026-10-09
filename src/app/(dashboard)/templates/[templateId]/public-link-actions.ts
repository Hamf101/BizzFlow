"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import type { ActionFeedbackCode } from "@/lib/action-result"
import { loadActionContext, runFormAction, type ActionActor } from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import {
  createPublicFormLink,
  disablePublicFormLink,
} from "@/services/public-form-service"

const templateIdSchema = z.string().uuid()

export async function createPublicFormLinkAction(
  formData: FormData
): Promise<void> {
  const expiresAt = getFormString(formData, "expiresAt")
  const maxSubmissionsRaw = getFormString(formData, "maxSubmissions")

  await runPublicLinkAction(formData, "public_link_created", (actor, templateId) =>
    createPublicFormLink({
      ...actor,
      templateId,
      expiresAt: expiresAt || null,
      maxSubmissions: maxSubmissionsRaw ? Number(maxSubmissionsRaw) : null,
    })
  )
}

export async function disablePublicFormLinkAction(
  formData: FormData
): Promise<void> {
  await runPublicLinkAction(formData, "public_link_disabled", (actor, templateId) =>
    disablePublicFormLink({
      ...actor,
      templateId,
      linkId: getFormString(formData, "linkId"),
    })
  )
}

// Who may manage a template's links is the service's to decide.
async function runPublicLinkAction(
  formData: FormData,
  success: ActionFeedbackCode,
  change: (actor: ActionActor, templateId: string) => Promise<unknown>
): Promise<never> {
  const templateId = getFormString(formData, "templateId")
  const linksPath = getPublicLinksPath(templateId)

  return runFormAction({
    event: `${success}_action`,
    path: linksPath,
    success,
    run: async () => {
      const { actor } = await loadActionContext(
        "You do not have permission to manage public form links.",
        403
      )
      await change(actor, templateId)
      revalidatePath(linksPath)
    },
  })
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
