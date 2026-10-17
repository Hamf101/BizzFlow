import { createHash } from "node:crypto"

import type { EmailTransport } from "@/services/email/contracts"
import { escapeHtml } from "@/services/email/html"
import { deliverTransactionalEmail } from "@/services/email/transport"
import { ServiceError } from "@/services/service-error"

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
export class DocumentSigningEmailServiceError extends ServiceError {
  override readonly name = "DocumentSigningEmailServiceError"
}

/**
 * Sends a recipient a time-limited link for filling or signing a document.
 *
 * @param input - Document, organization, recipient, and one-time link details.
 * @param deps - Optional email transport dependency for tests.
 * @returns Resolves after EmailJS accepts the email.
 * @throws DocumentSigningEmailServiceError when configuration or delivery fails.
 */
export async function sendDocumentSigningEmail(
  input: SendDocumentSigningEmailInput,
  deps: DocumentSigningEmailServiceDeps = {}
): Promise<void> {
  await deliverTransactionalEmail({
    name: "document",
    logPrefix: "document_signing_email",
    ids: { documentId: input.documentId, recipientId: input.recipientId },
    path: () => `/sign/${encodeURIComponent(input.token)}`,
    deliveryReference: createSigningDeliveryReference(input),
    toEmail: input.recipientEmail,
    compose: (signingUrl) => ({
      subject: `${input.organizationName} sent you ${input.documentTitle}`,
      contentHtml: createSigningEmailHtml(input, signingUrl),
      text: createSigningEmailText(input, signingUrl),
    }),
    fail: (message, statusCode) => new DocumentSigningEmailServiceError(message, statusCode),
    explainRejection: true,
    transport: deps.transport,
  })
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

/** One signer whose link stopped working when the sender took the document back to edit. */
export type SendDocumentSigningCancelledEmailInput = Omit<SendDocumentSigningEmailInput, "token"> & {
  /** When the cancelled round began, so a second cancel is a second email. */
  revokedAt: string
  signed: boolean
}

/**
 * Tells a signer the document they were sent is being changed, so their link
 * no longer works; one who signed learns their signature no longer counts.
 *
 * @param input - Document, organization, signer, and whether they had signed.
 * @param deps - Optional email transport dependency for tests.
 * @returns Resolves after EmailJS accepts the email.
 * @throws DocumentSigningEmailServiceError when configuration or delivery fails.
 */
export async function sendDocumentSigningCancelledEmail(
  input: SendDocumentSigningCancelledEmailInput,
  deps: DocumentSigningEmailServiceDeps = {}
): Promise<void> {
  const lead = `${input.organizationName} is changing ${input.documentTitle}, so the signing link you were sent no longer works.`
  const next = input.signed
    ? "Your signature no longer counts. If they still need it, you will get a new link to sign the changed document."
    : "If they still need your signature, you will get a new link."

  await deliverTransactionalEmail({
    name: "document",
    logPrefix: "document_signing_cancelled_email",
    ids: { documentId: input.documentId, recipientId: input.recipientId },
    // Nothing to open: the old link is gone and a new one comes with its own email.
    path: () => "/",
    deliveryReference: `document-signing-cancelled/${input.documentId}/${input.recipientId}/${input.revokedAt}`,
    toEmail: input.recipientEmail,
    compose: () => ({
      subject: `${input.documentTitle} is being changed`,
      contentHtml: toParagraphs([lead, next]),
      text: `${lead} ${next}`,
    }),
    fail: (message, statusCode) => new DocumentSigningEmailServiceError(message, statusCode),
    explainRejection: true,
    transport: deps.transport,
  })
}

/** The sender of a round one signer declined. */
export type SendDocumentSigningDeclinedEmailInput = {
  declinedAt: string
  declinerName: string
  documentId: string
  documentTitle: string
  reason: string
  recipientEmail: string
}

/**
 * Tells the sender a signer declined, and why; the document is a draft again.
 *
 * @param input - Document, who declined, their reason, and the sender's address.
 * @param deps - Optional email transport dependency for tests.
 * @returns Resolves after EmailJS accepts the email.
 * @throws DocumentSigningEmailServiceError when configuration or delivery fails.
 */
export async function sendDocumentSigningDeclinedEmail(
  input: SendDocumentSigningDeclinedEmailInput,
  deps: DocumentSigningEmailServiceDeps = {}
): Promise<void> {
  const lead = `${input.declinerName} declined to sign ${input.documentTitle}.`
  const reason = `Their reason: “${input.reason}”`
  const next = "The document is a draft again and every signing link has stopped working. Change it and send it again when you are ready."

  await deliverTransactionalEmail({
    name: "document",
    logPrefix: "document_signing_declined_email",
    ids: { documentId: input.documentId },
    path: () => `/documents/${encodeURIComponent(input.documentId)}/edit`,
    deliveryReference: `document-signing-declined/${input.documentId}/${input.declinedAt}`,
    toEmail: input.recipientEmail,
    compose: () => ({
      subject: `${input.declinerName} declined to sign ${input.documentTitle}`,
      contentHtml: toParagraphs([lead, reason, next]),
      text: `${lead} ${reason} ${next}`,
    }),
    fail: (message, statusCode) => new DocumentSigningEmailServiceError(message, statusCode),
    explainRejection: true,
    transport: deps.transport,
  })
}

function toParagraphs(lines: string[]): string {
  return lines
    .map((line) => `<p style="margin:0 0 12px;color:#706a72;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">${escapeHtml(line)}</p>`)
    .join("")
}
