import { getAppUrlEnv, getEmailEnv } from "@/lib/env"
import { createActionEmailHtml, wrapEmailDocument } from "@/services/email/html"
import { sendEmail } from "@/services/email/transport"
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
  const emailEnv = getEmailEnv()
  const url = new URL(`/forms/${encodeURIComponent(request.token)}`, getAppUrlEnv().NEXT_PUBLIC_APP_URL).toString()
  const subject = `${request.senderName} sent you “${request.title}” to fill in`
  const body = `${request.senderName} at ${request.organizationName} asked you to fill in a document on BizFlow Docs. It takes your answers; you don't need an account.`

  await sendEmail(
    {
      deliveryReference: `answer-request/${request.linkId}`,
      payload: {
        html: wrapEmailDocument({
          contentHtml: createActionEmailHtml({
            action: "Fill it in",
            body,
            heading: request.title,
            note: "The link is yours: it takes one set of answers within seven days. If you weren't expecting this, you can ignore it.",
            url,
          }),
          subject,
        }),
        subject,
        text: `${body} ${url}`,
        toEmail: request.recipientEmail,
        ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
      },
    },
    emailEnv
  )
}
