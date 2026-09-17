"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import {
  enforceActionRateLimit,
  enforceOutboundEmailRateLimit,
} from "@/lib/action-rate-limit"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
} from "@/lib/action-result"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { SaveResult } from "@/components/editor/use-autosave"
import {
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
  updateGeneratedDocumentContent,
} from "@/services/document-signing-service"
import type { DocumentRecipientInput } from "@/types/signing"
import type { OrganizationContext } from "@/types/organization"

type MemberDocumentActionContext = {
  actorUserId: string
  context: OrganizationContext
}

class MemberDocumentActionError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = "MemberDocumentActionError"
    this.statusCode = statusCode
  }
}

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
    const actionContext = await loadMemberActionContext("documents:fill")
    const saved = await updateGeneratedDocumentContent({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      documentId: requireIdentifier(input.documentId, "Document id"),
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
    const actionContext = await loadMemberActionContext("documents:fill")
    await saveGeneratedDocumentAnswers({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      documentId: requireIdentifier(documentId, "Document id"),
      values: parseGeneratedDocumentAnswers(formData),
    })

    return { ok: true, version: "answers" }
  } catch (error: unknown) {
    return toSaveFailure(error, "generated_document_answers_save_failed", documentId)
  }
}

function toSaveFailure(error: unknown, eventName: string, documentId: string): SaveResult {
  if (error instanceof AuthenticationError) {
    return { message: "Sign in again to keep saving.", ok: false, status: 401 }
  }

  const statusCode =
    error instanceof GeneratedDocumentFormDataError
      ? 400
      : typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500

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
  const startedAt = Date.now()

  // One submission fans out to as many as MAX_RECIPIENTS emails. Both calls
  // reject by throwing (a redirect), so they must stay outside the try below.
  const user = await loadAuthenticatedPageUser(editorPath)
  await enforceOutboundEmailRateLimit({
    userId: user.id,
    redirectPath: editorPath,
  })

  try {
    const actionContext = await loadMemberActionContext("documents:send")
    const recipients = parseRecipientCollection(
      getFormString(formData, "recipients")
    )

    await sendDocumentForSigning({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      documentId: requireIdentifier(documentId, "Document id"),
      recipients,
    })
    revalidateDocumentEditor(documentId)
    console.info("generated_document_send_action_completed", {
      documentId,
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      recipientCount: recipients.length,
    })
  } catch (error: unknown) {
    handleMemberActionFailure({
      documentId,
      error,
      eventName: "generated_document_send_action_failed",
      nextPath: editorPath,
      startedAt,
    })
  }

  redirect(buildFeedbackRedirect(editorPath, "signing_invitations_sent"))
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
  const startedAt = Date.now()

  // This action re-mails one external recipient on demand, so it needs a budget
  // per recipient as well as per member: without it a resend loop is a mailbomb
  // aimed at a third party. Both calls redirect by throwing — keep them outside
  // the try below.
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

  try {
    const actionContext = await loadMemberActionContext("documents:send")
    await resendDocumentSigningInvitation({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      documentId: requireIdentifier(documentId, "Document id"),
      recipientId: requireIdentifier(recipientId, "Recipient id"),
    })
    revalidateDocumentEditor(documentId)
    console.info("generated_document_resend_action_completed", {
      documentId,
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
      recipientId,
    })
  } catch (error: unknown) {
    handleMemberActionFailure({
      documentId,
      error,
      eventName: "generated_document_resend_action_failed",
      nextPath: editorPath,
      startedAt,
    })
  }

  redirect(buildFeedbackRedirect(editorPath, "signing_invitation_resent"))
}

async function loadMemberActionContext(
  action: OrganizationPermissionAction
): Promise<MemberDocumentActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new MemberDocumentActionError(
      "Create an organization before managing documents.",
      428
    )
  }

  if (!canPerformOrganizationAction(context.membership, action)) {
    throw new MemberDocumentActionError(
      "You do not have permission to perform this document action.",
      403
    )
  }

  return { actorUserId: user.id, context }
}

function parseRecipientCollection(value: string): DocumentRecipientInput[] {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(value) as unknown
  } catch {
    throw new MemberDocumentActionError("The recipient collection is invalid.")
  }

  if (!Array.isArray(parsedValue)) {
    throw new MemberDocumentActionError("The recipient collection is invalid.")
  }

  return parsedValue.map((value: unknown): DocumentRecipientInput => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new MemberDocumentActionError("A signing recipient is invalid.")
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
      throw new MemberDocumentActionError(
        "Every document recipient must provide a signature."
      )
    }

    return { name, email, requiresSignature: true }
  })
}

function requireIdentifier(value: string, label: string): string {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new MemberDocumentActionError(`${label} is required.`)
  }

  return normalizedValue
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

function handleMemberActionFailure(input: {
  documentId: string
  error: unknown
  eventName: string
  nextPath: string
  startedAt: number
}): never {
  if (input.error instanceof AuthenticationError) {
    redirect(buildRedirect("/login", { next: input.nextPath }))
  }

  console.warn(input.eventName, {
    documentId: input.documentId,
    durationMs: Date.now() - input.startedAt,
    reason:
      input.error instanceof Error
        ? input.error.message
        : "Unknown generated document action error",
  })
  redirect(
    buildFeedbackRedirect(
      input.nextPath,
      input.error instanceof GeneratedDocumentFormDataError
        ? "invalid_input"
        : getActionErrorFeedbackCode(input.error)
    )
  )
}
