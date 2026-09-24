import type { EmailEnv } from "@/lib/env"
import type {
  EmailTransport,
  SendEmailInput,
  SendEmailResult,
} from "@/services/email/contracts"
import { sendEmailJsEmail } from "@/services/email/emailjs-transport"

/**
 * Sends every transactional email through EmailJS.
 *
 * The Resend adapter remains isolated in `resend-transport.ts` for later
 * reactivation after sender verification, but it is intentionally unreachable.
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
