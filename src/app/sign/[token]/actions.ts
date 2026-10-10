"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"

import {
  GeneratedDocumentFormDataError,
  parseGeneratedDocumentAnswerBaseline,
  parseGeneratedDocumentAnswers,
} from "@/components/documents/generated-document-form-data"
import { getClientIp } from "@/lib/client-ip"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"
import {
  completePublicDocumentSigning,
  DocumentSigningServiceError,
} from "@/services/document-signing-service"
import { finalizeCompletedGeneratedDocument } from "@/services/generated-document-finalization-service"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

/**
 * Completes one public recipient's answer and acknowledgement submission.
 *
 * The raw private token is used only for the service call and redirect target;
 * it is never logged or persisted by this action.
 *
 * @param _previous - What the last try reported.
 * @param formData - Private token, answer fields, signature, and optional initials.
 * @returns Why it could not be signed, so the page keeps the drawing and
 *   answers; signing redirects to the signing view with its feedback.
 */
export async function completePublicSigningAction(
  _previous: Readonly<{ error: string }> | null,
  formData: FormData
): Promise<Readonly<{ error: string }>> {
  const token = getFormString(formData, "token")
  const signingPath = getSigningPath(token)
  const startedAt = Date.now()
  let workflowStatus: GeneratedDocumentWorkflowStatus = "awaiting_signatures"

  try {
    await checkRateLimit("public_signing", getClientIp(await headers()))

    const view = await completePublicDocumentSigning({
      token,
      values: parseGeneratedDocumentAnswers(formData),
      baselineValues: parseGeneratedDocumentAnswerBaseline(formData),
      signatureDataUrl: getFormString(formData, "signatureDataUrl") || null,
      initialsDataUrl: getFormString(formData, "initialsDataUrl") || null,
    })

    workflowStatus = view.workflowStatus

    if (view.workflowStatus === "completed") {
      // The signer does not wait for the paper to be rendered and stored.
      after(() => finalizeCompletedGeneratedDocument(view.document))
    }
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
    return { error: errorMessage }
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
  if (error instanceof RateLimitError) {
    return "Too many requests. Wait a moment and try again."
  }

  if (
    error instanceof DocumentSigningServiceError ||
    error instanceof GeneratedDocumentFormDataError
  ) {
    return error.message
  }

  return fallback
}
