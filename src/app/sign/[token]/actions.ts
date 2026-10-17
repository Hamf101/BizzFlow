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
  declinePublicDocumentSigning,
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
    const ip = getClientIp(await headers())
    await checkRateLimit("public_signing", ip)

    const view = await completePublicDocumentSigning({
      consented: formData.get("consent") === "on",
      // Kept for the completion certificate; an address the proxy didn't give is none.
      ip: ip === "unknown" ? null : ip,
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

/** What a decline reported: why it failed, or whose document was turned down. */
export type DeclineSigningState = Readonly<{ error: string } | { declinedFor: string }> | null

/**
 * Declines to sign through a private link, with the signer's reason.
 *
 * @param _previous - What the last try reported.
 * @param formData - Private token and reason.
 * @returns Why it failed, or the organization that was told; the link stops
 *   working, so the confirmation stays on this page rather than reloading it.
 */
export async function declinePublicSigningAction(
  _previous: DeclineSigningState,
  formData: FormData
): Promise<DeclineSigningState> {
  try {
    await checkRateLimit("public_signing", getClientIp(await headers()))
    const declined = await declinePublicDocumentSigning({
      token: getFormString(formData, "token"),
      reason: getFormString(formData, "reason"),
    })
    return { declinedFor: declined.organizationName }
  } catch (error: unknown) {
    const errorMessage = getPublicSigningActionErrorMessage(error, "Unable to decline. Try again.")
    console.warn("public_document_signing_decline_failed", { reason: errorMessage })
    return { error: errorMessage }
  }
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
