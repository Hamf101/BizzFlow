import { buildSharedDocumentPath } from "@/lib/auth-redirects"
import type { GuestInvite } from "@/services/documents/sharing-contracts"
import { sendLinkEmail } from "@/services/email/transport"

/**
 * Emails someone outside the workspace the link to one document. The link is
 * theirs alone: it works once, for this address, within seven days.
 *
 * @param invite - The document, who sent it, and the one-time link's secret.
 * @returns Resolves once the provider accepts the email.
 * @throws Error when email is not configured or the provider refuses it.
 */
export async function sendGuestInviteEmail(invite: GuestInvite): Promise<void> {
  await sendLinkEmail({
    deliveryReference: `document-guest/${invite.grantId}`,
    toEmail: invite.recipientEmail,
    path: buildSharedDocumentPath(invite.token),
    subject: `${invite.inviterName} shared “${invite.documentTitle}” with you`,
    action: "Open the document",
    body: `${invite.inviterName} at ${invite.organizationName} shared a document with you on BizFlow Docs. Sign in, or choose a password, to open it.`,
    heading: invite.documentTitle,
    note: "The link works once, for this email address, within seven days. If you were not expecting this, you can ignore it.",
  })
}
