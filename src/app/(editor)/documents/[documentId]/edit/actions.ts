"use server"

import { revalidatePath } from "next/cache"

import { parseGeneratedDocumentAnswers } from "@/components/documents/generated-document-form-data"
import {
  enforceActionRateLimit,
  enforceOutboundEmailRateLimit,
} from "@/lib/action-rate-limit"
import { getErrorStatusCode } from "@/lib/action-result"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  ActionError,
  loadActionContext,
  requireFormId,
  runFormAction,
  type ActionActor,
} from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { findGuestOrganizationId } from "@/services/document-service"
import type { SaveResult } from "@/components/editor/use-autosave"
import {
  cancelDocumentSigning,
  fillGeneratedDocumentAnswers,
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
  updateGeneratedDocumentContent,
} from "@/services/document-signing-service"
import { createDocumentCopy } from "@/services/template-service"
import type { DocumentRecipientInput } from "@/types/signing"
import type { FlowFillResult } from "@/types/template-flow"

// The signing services check the actor's document access and permission themselves.
const NO_ORGANIZATION = "Create an organization before managing documents."

/** A draft's title and page, as the editor saves them while they change. */
export type DocumentContentInput = {
  content: unknown
  documentId: string
  /** The document's version when the editor last loaded or saved it. */
  expectedUpdatedAt: string
  title: string
}

/**
 * Saves a draft's title and page from the editor, without leaving the page.
 *
 * @param input - The document, the version the editor holds, and the page.
 * @returns The version to save from next, or why the save was refused.
 */
export async function saveDocumentContentAction(input: DocumentContentInput): Promise<SaveResult> {
  try {
    const documentId = requireFormId(input.documentId, "Document id")
    const saved = await updateGeneratedDocumentContent({
      ...(await loadFillActionContext(documentId)),
      documentId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      title: input.title,
      content: input.content,
    })

    revalidatePath("/documents")
    return { ok: true, version: saved.updatedAt }
  } catch (error: unknown) {
    return toSaveFailure(error, "generated_document_content_save_failed", input.documentId)
  }
}

/**
 * Saves the answers typed into a document's fields, without leaving the page.
 *
 * @param formData - The document id and its namespaced answer fields.
 * @returns A result the editor shows as its save status.
 */
export async function saveDocumentAnswersAction(formData: FormData): Promise<SaveResult> {
  const documentId = getFormString(formData, "documentId")

  try {
    const id = requireFormId(documentId, "Document id")
    await saveGeneratedDocumentAnswers({
      ...(await loadFillActionContext(id)),
      documentId: id,
      values: parseGeneratedDocumentAnswers(formData),
    })

    return { ok: true, version: "answers" }
  } catch (error: unknown) {
    return toSaveFailure(error, "generated_document_answers_save_failed", documentId)
  }
}

/**
 * Fills a document with the answers Flow read off the form it recreated,
 * keeping only those its fields take.
 *
 * @param documentId - The document.
 * @param answers - The answers, keyed by field key; the service checks each.
 * @returns The answers the document now holds and how many fit, or why not.
 */
export async function fillDocumentAnswersAction(documentId: string, answers: unknown): Promise<FlowFillResult> {
  try {
    const id = requireFormId(documentId, "Document id")
    const { dropped, kept, view } = await fillGeneratedDocumentAnswers({ ...(await loadFillActionContext(id)), answers, documentId: id })

    return { answers: view.answers, dropped, kept, ok: true }
  } catch (error: unknown) {
    const failure = toSaveFailure(error, "generated_document_answers_fill_failed", documentId)

    return { message: failure.ok ? "The answers couldn't be filled in." : failure.message, ok: false }
  }
}

function toSaveFailure(error: unknown, eventName: string, documentId: string): SaveResult {
  if (error instanceof AuthenticationError) {
    return { message: "Sign in again to keep saving.", ok: false, status: 401 }
  }

  const statusCode = getErrorStatusCode(error) ?? 500

  console.warn(eventName, {
    documentId,
    reason: error instanceof Error ? error.message : "Unknown generated document save error",
  })

  return {
    message: statusCode === 500 ? "The document could not be saved." : (error as Error).message,
    ok: false,
    status: statusCode,
  }
}

/**
 * Adds an unordered batch of recipients and emails private signing links.
 *
 * @param formData - Generated document id and serialized recipient collection.
 * @returns Never returns; redirects with delivery status or a typed error.
 */
export async function sendGeneratedDocumentAction(
  formData: FormData
): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const editorPath = getDocumentEditorPath(documentId)

  // One submission fans out to as many as MAX_RECIPIENTS emails. Both calls
  // reject by throwing (a redirect), so they must stay outside the action run below.
  const user = await loadAuthenticatedPageUser(editorPath)
  await enforceOutboundEmailRateLimit({
    userId: user.id,
    redirectPath: editorPath,
  })

  await runFormAction({
    event: "generated_document_send_action",
    log: { documentId },
    path: editorPath,
    success: "signing_invitations_sent",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)

      const { undelivered } = await sendDocumentForSigning({
        ...actor,
        documentId: requireFormId(documentId, "Document id"),
        recipients: parseRecipientCollection(getFormString(formData, "recipients")),
      })
      revalidateDocumentEditor(documentId)

      return undelivered > 0 ? { code: "signing_invitations_partly_sent" } : undefined
    },
  })
}

/**
 * Rotates and resends one pending recipient's private signing link.
 *
 * @param formData - Generated document and recipient identifiers.
 * @returns Never returns; redirects with delivery status or a typed error.
 */
export async function resendGeneratedDocumentInvitationAction(
  formData: FormData
): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const recipientId = getFormString(formData, "recipientId")
  const editorPath = getDocumentEditorPath(documentId)

  // This action re-mails one external recipient on demand, so it needs a budget
  // per recipient as well as per member: without it a resend loop is a mailbomb
  // aimed at a third party. Both calls redirect by throwing — keep them outside
  // the action run below.
  const user = await loadAuthenticatedPageUser(editorPath)
  await enforceActionRateLimit({
    bucket: "email_recipient",
    feedbackCode: "retry_later",
    key: `${user.id}:${documentId}:${recipientId}`,
    redirectPath: editorPath,
  })
  await enforceOutboundEmailRateLimit({
    userId: user.id,
    redirectPath: editorPath,
  })

  await runFormAction({
    event: "generated_document_resend_action",
    log: { documentId, recipientId },
    path: editorPath,
    success: "signing_invitation_resent",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)

      await resendDocumentSigningInvitation({
        ...actor,
        documentId: requireFormId(documentId, "Document id"),
        recipientId: requireFormId(recipientId, "Recipient id"),
      })
      revalidateDocumentEditor(documentId)
    },
  })
}

/**
 * Takes a document awaiting signatures back to a draft to edit, revoking every
 * signer's link and telling each of them by email.
 *
 * @param formData - Generated document id.
 * @returns Never returns; redirects back to the editor, now editable.
 */
export async function cancelDocumentSigningAction(formData: FormData): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const editorPath = getDocumentEditorPath(documentId)

  // It emails every signer, so it spends the member's outbound budget as a
  // send does. Both calls redirect by throwing; keep them outside the run.
  const user = await loadAuthenticatedPageUser(editorPath)
  await enforceOutboundEmailRateLimit({ userId: user.id, redirectPath: editorPath })

  await runFormAction({
    event: "generated_document_cancel_signing_action",
    log: { documentId },
    path: editorPath,
    success: "signing_cancelled",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)

      await cancelDocumentSigning({ ...actor, documentId: requireFormId(documentId, "Document id") })
      revalidateDocumentEditor(documentId)
    },
  })
}

/**
 * Makes a new draft of a document, without its signatures, and opens it.
 *
 * @param formData - The id of the document to copy.
 * @returns Never returns; redirects to the copy's editor.
 */
export async function copyDocumentAction(formData: FormData): Promise<void> {
  const documentId = getFormString(formData, "documentId")

  await runFormAction({
    event: "generated_document_copy_action",
    log: { documentId },
    path: getDocumentEditorPath(documentId),
    success: "document_created",
    run: async () => {
      const { actor } = await loadActionContext(NO_ORGANIZATION)
      const copy = await createDocumentCopy({ ...actor, documentId: requireFormId(documentId, "Document id") })

      revalidatePath("/documents")
      return { path: getDocumentEditorPath(copy.documentId) }
    },
  })
}

// Someone outside the workspace given the document as an Editor fills it in
// its own workspace; the service then checks their grant like a member's access.
async function loadFillActionContext(documentId: string): Promise<ActionActor> {
  const user = await getAuthenticatedUser()
  const guestOrganizationId = await findGuestOrganizationId({ documentId, userId: user.id })

  if (guestOrganizationId) {
    return { actorUserId: user.id, organizationId: guestOrganizationId }
  }

  return (await loadActionContext(NO_ORGANIZATION)).actor
}

function parseRecipientCollection(value: string): DocumentRecipientInput[] {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(value) as unknown
  } catch {
    throw new ActionError("The recipient collection is invalid.")
  }

  if (!Array.isArray(parsedValue)) {
    throw new ActionError("The recipient collection is invalid.")
  }

  return parsedValue.map((value: unknown): DocumentRecipientInput => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ActionError("A signing recipient is invalid.")
    }

    const name = "name" in value ? value.name : null
    const email = "email" in value ? value.email : null
    const requiresSignature =
      "requiresSignature" in value ? value.requiresSignature : true

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      requiresSignature !== true
    ) {
      throw new ActionError(
        "Every document recipient must provide a signature."
      )
    }

    return { name, email, requiresSignature: true }
  })
}

function revalidateDocumentEditor(documentId: string): void {
  revalidatePath("/documents")
  revalidatePath(`/documents/${documentId}`)
  revalidatePath(`/documents/${documentId}/edit`)
}

function getDocumentEditorPath(documentId: string): string {
  const normalizedDocumentId = documentId.trim()
  return normalizedDocumentId
    ? `/documents/${encodeURIComponent(normalizedDocumentId)}/edit`
    : "/documents"
}
