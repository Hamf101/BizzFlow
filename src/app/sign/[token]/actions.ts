"use server"

import { redirect } from "next/navigation"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswerBaseline,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  completePublicDocumentSigning,
  DocumentSigningServiceError,
} from "@/services/document-signing-service"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

/**
 * Completes one public recipient's answer and acknowledgement submission.
 *
 * The raw private token is used only for the service call and redirect target;
 * it is never logged or persisted by this action.
 *
 * @param formData - Private token, answer fields, signature, and optional initials.
 * @returns Never returns; redirects to the safe signing view with status feedback.
 */
export async function completePublicSigningAction(
  formData: FormData
): Promise<void> {
  const token = getFormString(formData, "token")
  const signingPath = getSigningPath(token)
  const startedAt = Date.now()
  let workflowStatus: GeneratedDocumentWorkflowStatus = "awaiting_signatures"

  try {
    const view = await completePublicDocumentSigning({
      token,
      values: parseGeneratedDocumentAnswers(formData),
      baselineValues: parseGeneratedDocumentAnswerBaseline(formData),
      signatureDataUrl: getFormString(formData, "signatureDataUrl") || null,
      initialsDataUrl: getFormString(formData, "initialsDataUrl") || null,
    })

    workflowStatus = view.workflowStatus
    console.info("public_document_signing_action_completed", {
      documentId: view.document.id,
      durationMs: Date.now() - startedAt,
      recipientId: view.recipient.id,
      workflowStatus: view.workflowStatus,
    })
  } catch (error: unknown) {
    const errorMessage = getPublicSigningActionErrorMessage(
      error,
      "Unable to complete document signing."
    )

    // Deliberately omit the private token and token-derived path from logs.
    console.warn("public_document_signing_action_failed", {
      durationMs: Date.now() - startedAt,
      reason: errorMessage,
    })
    redirect(buildRedirect(signingPath, { error: errorMessage }))
  }

  redirect(
    buildRedirect(signingPath, {
      message:
        workflowStatus === "completed"
          ? "Your signature was recorded. All parties have signed."
          : "Your signature was recorded. The document is waiting for the other parties.",
    })
  )
}

function getSigningPath(token: string): string {
  const normalizedToken = token.trim()
  return normalizedToken ? `/sign/${encodeURIComponent(normalizedToken)}` : "/sign"
}

function getPublicSigningActionErrorMessage(
  error: unknown,
  fallback: string
): string {
  if (
    error instanceof DocumentSigningServiceError ||
    error instanceof GeneratedDocumentFormDataError
  ) {
    return error.message
  }

  return fallback
}
