import { getAppUrlEnv, getEmailEnv, type EmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  type EmailPayload,
  type EmailTransport,
  type SendEmailInput,
  type SendEmailResult,
} from "@/services/email/contracts"
import { sendEmailJsEmail } from "@/services/email/emailjs-transport"
import { createActionEmailHtml, wrapEmailDocument } from "@/services/email/html"
import type { LogValue } from "@/services/operation"

/**
 * Sends every transactional email through EmailJS, the only email provider.
 *
 * @param input - Internal delivery reference and provider-neutral content.
 * @param environment - Validated EmailJS credential configuration.
 * @returns Provider delivery metadata safe for logs.
 */
export const sendEmail: EmailTransport = async (
  input: SendEmailInput,
  environment: EmailEnv
): Promise<SendEmailResult> => {
  return sendEmailJsEmail(input, environment)
}

/**
 * Explains a provider rejection without exposing provider response bodies.
 *
 * @param status - Provider HTTP status when available.
 * @returns A user-safe, actionable configuration message.
 */
export function describeEmailRejection(status: number | null): string {
  switch (status) {
    case 400:
      return "EmailJS rejected the message. Check the service, template fields, and recipient address."
    case 401:
    case 403:
      return "EmailJS refused the request. Check the public and private account keys and service permissions."
    case 429:
      return "EmailJS is rate limiting this account. Try again shortly."
    default:
      return "Check the EmailJS configuration and try again."
  }
}

/** One transactional email that links into the app, and how to report on it. */
export type TransactionalEmail = {
  /** Names the email in messages, such as "invite" or "document". */
  name: string
  /** Prefixes the delivery log events, such as "invite_email". */
  logPrefix: string
  /** Safe ids logged with every event. */
  ids: Record<string, LogValue>
  /** The app path the email links to; read inside the configuration check. */
  path: () => string
  deliveryReference: string
  toEmail: string
  /** The subject, body fragment, and plain text, given the link. */
  compose: (url: string) => { subject: string; contentHtml: string; text: string }
  /** Builds the caller's own service error. */
  fail: (message: string, statusCode: number) => Error
  /** Adds the provider's reason when it refuses the message. */
  explainRejection: boolean
  transport?: EmailTransport
}

/**
 * Sends one transactional email that links into the app, logging its
 * delivery and turning every failure into the caller's own safe error.
 *
 * @param email - The message, its link, and how to log and fail.
 * @returns Resolves once the provider accepts the email.
 * @throws The caller's error: 500 when email is not configured, 502 when delivery fails.
 */
export async function deliverTransactionalEmail(email: TransactionalEmail): Promise<void> {
  const startedAt = performance.now()
  const durationMs = (): number => Math.round(performance.now() - startedAt)
  let emailEnv: EmailEnv
  let url: string

  try {
    emailEnv = getEmailEnv()
    url = new URL(email.path(), getAppUrlEnv().NEXT_PUBLIC_APP_URL).toString()
  } catch {
    console.error(`${email.logPrefix}_configuration_failed`, {
      ...email.ids,
      durationMs: durationMs(),
      failureKind: "invalid_configuration",
    })
    throw email.fail(
      `${email.name.charAt(0).toUpperCase()}${email.name.slice(1)} email is not configured. Add the required email provider environment variables.`,
      500
    )
  }

  const { contentHtml, subject, text } = email.compose(url)
  const payload: EmailPayload = {
    toEmail: email.toEmail,
    subject,
    html: wrapEmailDocument({ subject, contentHtml }),
    text,
    ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
  }

  try {
    const result = await (email.transport ?? sendEmail)(
      { deliveryReference: email.deliveryReference, payload },
      emailEnv
    )

    console.info(`${email.logPrefix}_delivered`, {
      ...email.ids,
      providerStatus: result.providerStatus,
      providerMessageId: result.providerMessageId,
      durationMs: durationMs(),
    })
  } catch (error: unknown) {
    const transportError = error instanceof EmailTransportError ? error : null

    console.error(`${email.logPrefix}_delivery_failed`, {
      ...email.ids,
      durationMs: durationMs(),
      failureKind: transportError?.kind ?? "unexpected_transport_error",
      providerStatus: transportError?.providerStatus ?? null,
    })

    if (email.explainRejection && transportError?.kind === "provider_rejected") {
      throw email.fail(
        `Unable to send the ${email.name} email. ${describeEmailRejection(transportError.providerStatus)}`,
        502
      )
    }

    throw email.fail(`Unable to send the ${email.name} email. Try again shortly.`, 502)
  }
}

/**
 * Emails someone a link that asks for one thing, such as answering or
 * opening a document. Any failure is thrown as it is, for the caller to handle.
 *
 * @param email - Who it is for, the app path it links to, and the words.
 * @returns Resolves once the provider accepts the email.
 */
export async function sendLinkEmail(email: {
  deliveryReference: string
  toEmail: string
  path: string
  subject: string
  action: string
  body: string
  heading: string
  note: string
}): Promise<void> {
  const emailEnv = getEmailEnv()
  const url = new URL(email.path, getAppUrlEnv().NEXT_PUBLIC_APP_URL).toString()

  await sendEmail(
    {
      deliveryReference: email.deliveryReference,
      payload: {
        html: wrapEmailDocument({
          contentHtml: createActionEmailHtml({
            action: email.action,
            body: email.body,
            heading: email.heading,
            note: email.note,
            url,
          }),
          subject: email.subject,
        }),
        subject: email.subject,
        text: `${email.body} ${url}`,
        toEmail: email.toEmail,
        ...(emailEnv.EMAIL_REPLY_TO_EMAIL ? { replyTo: emailEnv.EMAIL_REPLY_TO_EMAIL } : {}),
      },
    },
    emailEnv
  )
}
