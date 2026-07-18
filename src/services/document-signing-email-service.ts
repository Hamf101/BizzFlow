import { createHash } from "node:crypto"

import { getAppUrlEnv, getResendEnv } from "@/lib/env"
import { escapeHtml } from "@/services/email/html"
import {
  ResendTransportError,
  sendResendEmail,
  type ResendEmailPayload,
  type ResendTransport,
} from "@/services/email/resend-transport"

export type SendDocumentSigningEmailInput = {
  documentId: string
  documentTitle: string
  organizationName: string
  recipientEmail: string
  recipientId: string
  recipientName: string
  token: string
}

export type DocumentSigningEmailServiceDeps = {
  transport?: ResendTransport
}

/**
 * Error raised when a document-signing invitation cannot be delivered.
 */
export class DocumentSigningEmailServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates a document-signing email error.
   *
   * @param message - User-safe delivery failure message.
   * @param statusCode - HTTP-style status code for the caller.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "DocumentSigningEmailServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Sends a recipient a time-limited link for filling or signing a document.
 *
 * @param input - Document, organization, recipient, and one-time link details.
 * @param deps - Optional email transport dependency for tests.
 * @returns Resolves after Resend accepts the email.
 * @throws DocumentSigningEmailServiceError when configuration or delivery fails.
 */
export async function sendDocumentSigningEmail(
  input: SendDocumentSigningEmailInput,
  deps: DocumentSigningEmailServiceDeps = {}
): Promise<void> {
  const startedAt = performance.now()
  let signingUrl: string
  let resendEnv: ReturnType<typeof getResendEnv>

  try {
    resendEnv = getResendEnv()
    signingUrl = new URL(
      `/sign/${encodeURIComponent(input.token)}`,
      getAppUrlEnv().NEXT_PUBLIC_APP_URL
    ).toString()
  } catch {
    console.error("document_signing_email_configuration_failed", {
      documentId: input.documentId,
      recipientId: input.recipientId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: "invalid_configuration",
    })
    throw new DocumentSigningEmailServiceError(
      "Document email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.",
      500
    )
  }

  const payload: ResendEmailPayload = {
    from: resendEnv.RESEND_FROM_EMAIL,
    to: [input.recipientEmail],
    subject: `${input.organizationName} sent you ${input.documentTitle}`,
    html: createSigningEmailHtml(input, signingUrl),
    text: createSigningEmailText(input, signingUrl),
    ...(resendEnv.RESEND_REPLY_TO_EMAIL
      ? { reply_to: resendEnv.RESEND_REPLY_TO_EMAIL }
      : {}),
  }

  try {
    const transport = deps.transport ?? sendResendEmail
    const result = await transport(
      {
        logicalDeliveryId: createSigningDeliveryId(input),
        payload,
      },
      resendEnv
    )

    console.info("document_signing_email_delivered", {
      documentId: input.documentId,
      recipientId: input.recipientId,
      resendEmailId: result.emailId,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error: unknown) {
    const transportError = error instanceof ResendTransportError ? error : null

    console.error("document_signing_email_delivery_failed", {
      documentId: input.documentId,
      recipientId: input.recipientId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    if (transportError?.kind === "provider_rejected") {
      throw new DocumentSigningEmailServiceError(
        "Unable to send the document email. Check the configured sender and try again.",
        502
      )
    }

    throw new DocumentSigningEmailServiceError(
      "Unable to send the document email. Try again shortly.",
      502
    )
  }
}

function createSigningEmailHtml(
  input: SendDocumentSigningEmailInput,
  signingUrl: string
): string {
  return [
    `<h2>${escapeHtml(input.organizationName)} sent you a document</h2>`,
    `<p>Hello ${escapeHtml(input.recipientName)},</p>`,
    `<p>Please review and complete <strong>${escapeHtml(input.documentTitle)}</strong>.</p>`,
    `<p><a href="${escapeHtml(signingUrl)}">Open document</a></p>`,
    "<p>This private link is intended only for you and expires automatically.</p>",
  ].join("")
}

function createSigningEmailText(
  input: SendDocumentSigningEmailInput,
  signingUrl: string
): string {
  return `${input.organizationName} sent you ${input.documentTitle}. Review and complete it using your private link: ${signingUrl}`
}

function createSigningDeliveryId(input: SendDocumentSigningEmailInput): string {
  const tokenDigest = createHash("sha256")
    .update(input.token, "utf8")
    .digest("hex")

  return `document-signing/${input.documentId}/${input.recipientId}/${tokenDigest}`
}
