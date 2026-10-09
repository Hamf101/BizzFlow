import { sendLinkEmail } from "@/services/email/transport"
import type { AnswerRequest } from "@/services/send-to-answer-service"

/**
 * Emails someone their own link to answer a document. The link takes one set
 * of answers, from anyone holding it, within seven days; no account is needed.
 *
 * @param request - What was sent, by whom, to whom, and the link's secret.
 * @returns Resolves once the provider accepts the email.
 * @throws Error when email is not configured or the provider refuses it.
 */
export async function sendAnswerRequestEmail(request: AnswerRequest): Promise<void> {
  await sendLinkEmail({
    deliveryReference: `answer-request/${request.linkId}`,
    toEmail: request.recipientEmail,
    path: `/forms/${encodeURIComponent(request.token)}`,
    subject: `${request.senderName} sent you “${request.title}” to fill in`,
    action: "Fill it in",
    body: `${request.senderName} at ${request.organizationName} asked you to fill in a document on BizFlow Docs. It takes your answers; you don't need an account.`,
    heading: request.title,
    note: "The link is yours: it takes one set of answers within seven days. If you weren't expecting this, you can ignore it.",
  })
}
