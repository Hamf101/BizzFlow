import { getAppUrlEnv, getEmailJsEnv } from "@/lib/env"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { escapeHtml } from "@/services/email/html"
import {
  EmailJsTransportError,
  sendEmailJsEmail,
  type EmailJsEmailPayload,
  type EmailJsTransport,
} from "@/services/email/emailjs-transport"

type SendInviteEmailInput = {
  inviteId: string
  organizationName: string
  recipientEmail: string
  token: string
}

export type InviteEmailServiceDeps = {
  transport?: EmailJsTransport
}

/**
 * Error raised when a pending invite cannot be delivered by email.
 */
export class InviteEmailServiceError extends Error {
  readonly statusCode: number

  /**
   * Creates an invite-email delivery error.
   *
   * @param message - User-safe delivery failure message.
   * @param statusCode - HTTP-style status code for the calling action.
   */
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "InviteEmailServiceError"
    this.statusCode = statusCode
  }
}

/**
 * Sends an organization invite with a link that supports account creation and sign-in.
 *
 * @param input - Invite identifiers and recipient details.
 * @param deps - Optional email transport dependency for tests.
 * @returns Resolves once EmailJS accepts the delivery request.
 * @throws InviteEmailServiceError when email configuration or delivery fails.
 */
export async function sendInviteEmail(
  input: SendInviteEmailInput,
  deps: InviteEmailServiceDeps = {}
): Promise<void> {
  const startedAt = performance.now()
  let emailJsEnv: ReturnType<typeof getEmailJsEnv>
  let invitationUrl: string

  try {
    emailJsEnv = getEmailJsEnv()
    const appUrl = getAppUrlEnv().NEXT_PUBLIC_APP_URL
    invitationUrl = new URL(buildAcceptInvitePath(input.token), appUrl).toString()
  } catch {
    console.error("invite_email_configuration_failed", {
      inviteId: input.inviteId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: "invalid_configuration",
    })
    throw new InviteEmailServiceError(
      "Invite email is not configured. Add the required EMAILJS environment variables.",
      500
    )
  }

  const payload: EmailJsEmailPayload = {
    toEmail: input.recipientEmail,
    subject: `You're invited to ${input.organizationName} on BizFlow Docs`,
    html: createInviteEmailHtml(input.organizationName, invitationUrl),
    text: createInviteEmailText(input.organizationName, invitationUrl),
    ...(emailJsEnv.EMAILJS_REPLY_TO_EMAIL
      ? { replyTo: emailJsEnv.EMAILJS_REPLY_TO_EMAIL }
      : {}),
  }

  try {
    const transport = deps.transport ?? sendEmailJsEmail
    const result = await transport(
      {
        deliveryReference: `organization-invite/${input.inviteId}`,
        payload,
      },
      emailJsEnv
    )

    console.info("invite_email_delivered", {
      inviteId: input.inviteId,
      providerStatus: result.providerStatus,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error: unknown) {
    const transportError = error instanceof EmailJsTransportError ? error : null

    console.error("invite_email_delivery_failed", {
      inviteId: input.inviteId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    if (transportError?.kind === "provider_rejected") {
      throw new InviteEmailServiceError(
        "Unable to send the invite email. Check the EmailJS configuration and try again.",
        502
      )
    }

    throw new InviteEmailServiceError(
      "Unable to send the invite email. Try again shortly.",
      502
    )
  }
}

function createInviteEmailHtml(
  organizationName: string,
  invitationUrl: string
): string {
  const safeOrganizationName = escapeHtml(organizationName)
  const safeInvitationUrl = escapeHtml(invitationUrl)

  return [
    `<h1 style="margin:0 0 16px;color:#171717;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;line-height:32px;">You&#39;ve been invited to ${safeOrganizationName}</h1>`,
    '<p style="margin:0 0 24px;color:#525252;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;">Create a BizFlow Docs account or sign in to join the workspace.</p>',
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;"><tr><td style="border-radius:8px;background-color:#171717;">',
    `<a href="${safeInvitationUrl}" target="_blank" style="display:inline-block;padding:12px 20px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">Accept invitation</a>`,
    "</td></tr></table>",
    '<p style="margin:0 0 8px;color:#737373;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">If the button does not work, copy and paste this link into your browser:</p>',
    `<p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;"><a href="${safeInvitationUrl}" target="_blank" style="color:#404040;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;text-decoration:underline;">${safeInvitationUrl}</a></p>`,
    '<p style="margin:0;padding-top:20px;border-top:1px solid #e5e5e5;color:#737373;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;">If you were not expecting this invitation, you can safely ignore this email.</p>',
  ].join("")
}

function createInviteEmailText(
  organizationName: string,
  invitationUrl: string
): string {
  return `You've been invited to ${organizationName} on BizFlow Docs. Create an account or sign in to join the workspace: ${invitationUrl}`
}
