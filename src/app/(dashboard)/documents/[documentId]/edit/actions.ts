"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  DocumentSigningServiceError,
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
} from "@/services/document-signing-service"
import type { DocumentRecipientInput } from "@/types/signing"
import type { OrganizationContext } from "@/types/organization"

type MemberDocumentActionContext = {
  actorUserId: string
  context: OrganizationContext
}

class MemberDocumentActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MemberDocumentActionError"
  }
}

/**
 * Saves the member's generated-document answer patch.
 *
 * @param formData - Generated document id and namespaced answer fields.
 * @returns Never returns; redirects with success or typed error feedback.
 */
export async function saveGeneratedDocumentAction(
  formData: FormData
): Promise<void> {
  const documentId = getFormString(formData, "documentId")
  const editorPath = getDocumentEditorPath(documentId)
  const startedAt = Date.now()

  try {
    const actionContext = await loadMemberActionContext("documents:fill")
    await saveGeneratedDocumentAnswers({
      actorUserId: actionContext.actorUserId,
      organizationId: actionContext.context.organization.id,
      documentId: requireIdentifier(documentId, "Document id"),
      values: parseGeneratedDocumentAnswers(formData),
    })
    revalidateDocumentEditor(documentId)
    console.info("generated_document_save_action_completed", {
      documentId,
      durationMs: Date.now() - startedAt,
      organizationId: actionContext.context.organization.id,
    })
  } catch (error: unknown) {
    handleMemberActionFailure({
      documentId,
      error,
      eventName: "generated_document_save_action_failed",
      fallback: "Unable to save document answers.",
      nextPath: editorPath,
      startedAt,
    })
  }

  redirect(buildRedirect(editorPath, { message: "Document answers saved." }))
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
      fallback: "Unable to send signing invitations.",
      nextPath: editorPath,
      startedAt,
    })
  }

  redirect(buildRedirect(editorPath, { message: "Signing invitations sent." }))
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
      fallback: "Unable to resend the signing invitation.",
      nextPath: editorPath,
      startedAt,
    })
  }

  redirect(buildRedirect(editorPath, { message: "Signing invitation resent." }))
}

async function loadMemberActionContext(
  action: OrganizationPermissionAction
): Promise<MemberDocumentActionContext> {
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new MemberDocumentActionError(
      "Create an organization before managing documents."
    )
  }

  if (!canPerformOrganizationAction(context.membership.role, action)) {
    throw new MemberDocumentActionError(
      "You do not have permission to perform this document action."
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
  fallback: string
  nextPath: string
  startedAt: number
}): never {
  if (input.error instanceof AuthenticationError) {
    redirect(buildRedirect("/login", { next: input.nextPath }))
  }

  console.warn(input.eventName, {
    documentId: input.documentId,
    durationMs: Date.now() - input.startedAt,
    reason: getMemberActionErrorMessage(input.error, input.fallback),
  })
  redirect(
    buildRedirect(input.nextPath, {
      error: getMemberActionErrorMessage(input.error, input.fallback),
    })
  )
}

function getMemberActionErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof DocumentSigningServiceError ||
    error instanceof MemberDocumentActionError ||
    error instanceof GeneratedDocumentFormDataError
  ) {
    return error.message
  }

  return fallback
}
