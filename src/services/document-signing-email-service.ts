import { createHash } from "node:crypto"

import { getAppUrlEnv, getEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  type EmailPayload,
  type EmailTransport,
} from "@/services/email/contracts"
import { escapeHtml, wrapEmailDocument } from "@/services/email/html"
import {
  describeEmailRejection,
  sendEmail,
} from "@/services/email/transport"

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
  transport?: EmailTransport
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
 * @returns Resolves after the selected provider accepts the email.
 * @throws DocumentSigningEmailServiceError when configuration or delivery fails.
 */
export async function sendDocumentSigningEmail(
  input: SendDocumentSigningEmailInput,
  deps: DocumentSigningEmailServiceDeps = {}
): Promise<void> {
  const startedAt = performance.now()
  let signingUrl: string
  let emailEnv: ReturnType<typeof getEmailEnv>

  try {
    emailEnv = getEmailEnv()
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
      "Document email is not configured. Add the required email provider environment variables.",
      500
    )
  }

  const subject = `${input.organizationName} sent you ${input.documentTitle}`
  const payload: EmailPayload = {
    toEmail: input.recipientEmail,
    subject,
    html: wrapEmailDocument({
      subject,
      contentHtml: createSigningEmailHtml(input, signingUrl),
    }),
    text: createSigningEmailText(input, signingUrl),
    ...(emailEnv.EMAIL_REPLY_TO_EMAIL
      ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL }
      : {}),
  }

  try {
    const transport = deps.transport ?? sendEmail
    const result = await transport(
      {
        deliveryReference: createSigningDeliveryReference(input),
        payload,
      },
      emailEnv
    )

    console.info("document_signing_email_delivered", {
      documentId: input.documentId,
      recipientId: input.recipientId,
      providerStatus: result.providerStatus,
      providerMessageId: result.providerMessageId,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error: unknown) {
    const transportError = error instanceof EmailTransportError ? error : null

    console.error("document_signing_email_delivery_failed", {
      documentId: input.documentId,
      recipientId: input.recipientId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    if (transportError?.kind === "provider_rejected") {
      throw new DocumentSigningEmailServiceError(
        `Unable to send the document email. ${describeEmailRejection(emailEnv, transportError.providerStatus)}`,
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
  const safeOrganizationName = escapeHtml(input.organizationName)
  const safeRecipientName = escapeHtml(input.recipientName)
  const safeDocumentTitle = escapeHtml(input.documentTitle)
  const safeSigningUrl = escapeHtml(signingUrl)

  return [
    `<h1 style="margin:0 0 16px;color:#252329;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:32px;">${safeOrganizationName} sent you a document</h1>`,
    `<p style="margin:0 0 12px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">Hello ${safeRecipientName},</p>`,
    `<p style="margin:0 0 24px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">Please review and complete <strong style="color:#252329;font-weight:700;">${safeDocumentTitle}</strong>.</p>`,
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;"><tr><td style="border-radius:8px;background-color:#635273;">',
    `<a href="${safeSigningUrl}" target="_blank" style="display:inline-block;padding:12px 20px;color:#fffdfc;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Review document</a>`,
    "</td></tr></table>",
    '<p style="margin:0 0 8px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">If the button does not work, copy and paste this link into your browser:</p>',
    `<p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeSigningUrl}" target="_blank" style="color:#635273;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;text-decoration:underline;">${safeSigningUrl}</a></p>`,
    '<p style="margin:0;padding-top:20px;border-top:1px solid #c9c2bb;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">This private link is intended only for you and expires automatically. Do not forward this email.</p>',
  ].join("")
}

function createSigningEmailText(
  input: SendDocumentSigningEmailInput,
  signingUrl: string
): string {
  return `${input.organizationName} sent you ${input.documentTitle}. Review and complete it using your private link: ${signingUrl}`
}

function createSigningDeliveryReference(
  input: SendDocumentSigningEmailInput
): string {
  const tokenDigest = createHash("sha256")
    .update(input.token, "utf8")
    .digest("hex")

  return `document-signing/${input.documentId}/${input.recipientId}/${tokenDigest}`
}
