import { getAppUrlEnv, getEmailEnv } from "@/lib/env"
import type { GuestInvite } from "@/services/documents/sharing-contracts"
import { createActionEmailHtml, wrapEmailDocument } from "@/services/email/html"
import { sendEmail } from "@/services/email/transport"

/**
 * Emails someone outside the workspace the link to one document. The link is
 * theirs alone: it works once, for this address, within seven days.
 *
 * @param invite - The document, who sent it, and the one-time link's secret.
 * @returns Resolves once the provider accepts the email.
 * @throws Error when email is not configured or the provider refuses it.
 */
export async function sendGuestInviteEmail(invite: GuestInvite): Promise<void> {
  const emailEnv = getEmailEnv()
  const url = new URL(`/shared/${encodeURIComponent(invite.token)}`, getAppUrlEnv().NEXT_PUBLIC_APP_URL).toString()
  const subject = `${invite.inviterName} shared “${invite.documentTitle}” with you`
  const body = `${invite.inviterName} at ${invite.organizationName} shared a document with you on BizFlow Docs. Sign in, or choose a password, to open it.`

  await sendEmail(
    {
      deliveryReference: `document-guest/${invite.grantId}`,
      payload: {
        html: wrapEmailDocument({
          contentHtml: createActionEmailHtml({
            action: "Open the document",
            body,
            heading: invite.documentTitle,
            note: "The link works once, for this email address, within seven days. If you were not expecting this, you can ignore it.",
            url,
          }),
          subject,
        }),
        subject,
        text: `${body} ${url}`,
        toEmail: invite.recipientEmail,
        ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
      },
    },
    emailEnv
  )
}
