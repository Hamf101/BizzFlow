"use server"

import { revalidatePath } from "next/cache"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import { ActionError, loadActionContext, requireFormId, runFormAction } from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { toSaveFailure } from "@/lib/save-failure"
import type { SaveResult } from "@/components/editor/use-autosave"
import { savePdfFieldLayout, sendPdfForSigning } from "@/services/pdf-signing-service"

// The PDF signing services check the member's access and permission themselves.
const NO_ORGANIZATION = "Create an organization before sending documents."

/**
 * Keeps where each signer's fields sit on an uploaded PDF.
 *
 * @param input - The document, the revision the screen last saw, and the fields.
 * @returns The new revision as the save's version, or why it was not kept
 *   (someone else saved first, or a field is invalid).
 */
export async function savePdfFieldsAction(
  input: Readonly<{ documentId: string; expectedRevision: number; layout: unknown }>
): Promise<SaveResult> {
  try {
    const { actor } = await loadActionContext(NO_ORGANIZATION)
    const { revision } = await savePdfFieldLayout({
      ...actor,
      documentId: requireFormId(input.documentId, "Document id"),
      expectedRevision: input.expectedRevision,
      layout: input.layout,
    })

    return { ok: true, version: String(revision) }
  } catch (error: unknown) {
    return toSaveFailure(error, "pdf_fields_save_failed", input.documentId)
  }
}

/**
 * Invites each signer of an uploaded PDF through their own private link.
 *
 * @param formData - The document and, as JSON, a name and email for each signer.
 * @returns Never returns; redirects to the document with how the emails went.
 */
export async function sendPdfForSigningAction(formData: FormData): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const path = `/documents/${encodeURIComponent(documentId)}`

  // One send fans out to an email per signer, so it counts against the sender's email allowance.
  const user = await loadAuthenticatedPageUser(`${path}/fields`)
  await enforceOutboundEmailRateLimit({ redirectPath: `${path}/fields`, userId: user.id })

  await runFormAction({
    event: "pdf_signing_send_action",
    log: { documentId },
    path,
    success: "signing_invitations_sent",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)
      const { undelivered } = await sendPdfForSigning({
        ...actor,
        documentId: requireFormId(documentId, "Document id"),
        recipients: parseRecipients(getFormString(formData, "recipients")),
      })
      revalidatePath(path)

      return undelivered > 0 ? { code: "signing_invitations_partly_sent" } : undefined
    },
  })
}

function parseRecipients(value: string): Array<{ email: string; name: string; signerId: string }> {
  let parsed: unknown

  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new ActionError("The signers could not be read.")
  }

  if (!Array.isArray(parsed)) {
    throw new ActionError("The signers could not be read.")
  }

  // The service checks each name, address and role; this only keeps the shape.
  return parsed.map((entry: unknown) => {
    const row = (entry ?? {}) as Record<string, unknown>
    const text = (key: string): string => (typeof row[key] === "string" ? (row[key] as string) : "")
    return { email: text("email"), name: text("name"), signerId: text("signerId") }
  })
}
