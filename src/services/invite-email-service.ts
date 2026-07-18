import { getAppUrlEnv, getResendEnv } from "@/lib/env"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { escapeHtml } from "@/services/email/html"
import {
  ResendTransportError,
  sendResendEmail,
  type ResendEmailPayload,
  type ResendTransport,
} from "@/services/email/resend-transport"

type SendInviteEmailInput = {
  inviteId: string
  organizationName: string
  recipientEmail: string
  token: string
}

export type InviteEmailServiceDeps = {
  transport?: ResendTransport
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
 * @returns Resolves once Resend accepts the delivery request.
 * @throws InviteEmailServiceError when email configuration or delivery fails.
 */
export async function sendInviteEmail(
  input: SendInviteEmailInput,
  deps: InviteEmailServiceDeps = {}
): Promise<void> {
  const startedAt = performance.now()
  let resendEnv: ReturnType<typeof getResendEnv>
  let invitationUrl: string

  try {
    resendEnv = getResendEnv()
    const appUrl = getAppUrlEnv().NEXT_PUBLIC_APP_URL
    invitationUrl = new URL(buildAcceptInvitePath(input.token), appUrl).toString()
  } catch {
    console.error("invite_email_configuration_failed", {
      inviteId: input.inviteId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: "invalid_configuration",
    })
    throw new InviteEmailServiceError(
      "Invite email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL.",
      500
    )
  }

  const payload: ResendEmailPayload = {
    from: resendEnv.RESEND_FROM_EMAIL,
    to: [input.recipientEmail],
    subject: `You're invited to ${input.organizationName} on BizFlow Docs`,
    html: createInviteEmailHtml(input.organizationName, invitationUrl),
    text: createInviteEmailText(input.organizationName, invitationUrl),
    ...(resendEnv.RESEND_REPLY_TO_EMAIL
      ? { reply_to: resendEnv.RESEND_REPLY_TO_EMAIL }
      : {}),
  }

  try {
    const transport = deps.transport ?? sendResendEmail
    const result = await transport(
      {
        logicalDeliveryId: `organization-invite/${input.inviteId}`,
        payload,
      },
      resendEnv
    )

    console.info("invite_email_delivered", {
      inviteId: input.inviteId,
      resendEmailId: result.emailId,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error: unknown) {
    const transportError = error instanceof ResendTransportError ? error : null

    console.error("invite_email_delivery_failed", {
      inviteId: input.inviteId,
      durationMs: Math.round(performance.now() - startedAt),
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    if (transportError?.kind === "provider_rejected") {
      throw new InviteEmailServiceError(
        "Unable to send the invite email. Check the configured sender and try again.",
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

  return `<h2>You've been invited to ${safeOrganizationName}</h2><p>Create a BizFlow Docs account or sign in to join the workspace.</p><p><a href="${safeInvitationUrl}">Accept invitation</a></p><p>If you were not expecting this email, you can safely ignore it.</p>`
}

function createInviteEmailText(
  organizationName: string,
  invitationUrl: string
): string {
  return `You've been invited to ${organizationName} on BizFlow Docs. Create an account or sign in to join the workspace: ${invitationUrl}`
}
