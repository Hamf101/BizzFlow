import type { EmailEnv } from "@/lib/env"
import type {
  EmailTransport,
  SendEmailInput,
  SendEmailResult,
} from "@/services/email/contracts"
import { sendEmailJsEmail } from "@/services/email/emailjs-transport"
import {
  describeResendRejection,
  sendResendEmail,
} from "@/services/email/resend-transport"

/**
 * Sends an email through the explicitly selected provider.
 *
 * @param input - Internal delivery reference and provider-neutral content.
 * @param environment - Validated provider and credential configuration.
 * @returns Provider delivery metadata safe for logs.
 */
export const sendEmail: EmailTransport = async (
  input: SendEmailInput,
  environment: EmailEnv
): Promise<SendEmailResult> => {
  if (environment.EMAIL_PROVIDER === "emailjs") {
    return sendEmailJsEmail(input, environment)
  }

  return sendResendEmail(input, environment)
}

/**
 * Explains a provider rejection without exposing provider response bodies.
 *
 * @param environment - Selected email provider configuration.
 * @param status - Provider HTTP status when available.
 * @returns A user-safe, actionable configuration message.
 */
export function describeEmailRejection(
  environment: EmailEnv,
  status: number | null
): string {
  if (environment.EMAIL_PROVIDER === "resend") {
    return describeResendRejection(status)
  }

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
