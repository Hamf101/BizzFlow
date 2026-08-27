import type { ResendEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  validateDeliveryReference,
  type SendEmailInput,
  type SendEmailResult,
} from "@/services/email/contracts"

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails"

export type EmailTransportDeps = {
  fetcher?: typeof fetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
}

/**
 * Sends one transactional email through the Resend API.
 *
 * The delivery reference travels as the `Idempotency-Key` header, so a
 * repeated request for the same logical delivery can never double-send,
 * and the reference stays visible for provider-side tracing.
 *
 * @param input - Internal delivery reference and escaped email content.
 * @param environment - Validated Resend credentials, sender, and timeout.
 * @param deps - Optional fetch and timeout-signal implementations for tests.
 * @returns The provider HTTP status and Resend email id.
 * @throws EmailTransportError when the reference, provider response, or request fails.
 */
export async function sendResendEmail(
  input: SendEmailInput,
  environment: ResendEmailEnv,
  deps: EmailTransportDeps = {}
): Promise<SendEmailResult> {
  validateDeliveryReference(input.deliveryReference)

  const fetcher = deps.fetcher ?? globalThis.fetch
  const createTimeoutSignal =
    deps.createTimeoutSignal ??
    ((timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs))

  try {
    const response = await fetcher(RESEND_EMAILS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.deliveryReference,
      },
      body: JSON.stringify({
        from: environment.RESEND_FROM_EMAIL,
        to: [input.payload.toEmail],
        subject: input.payload.subject,
        html: input.payload.html,
        text: input.payload.text,
        ...(input.payload.replyTo ? { reply_to: input.payload.replyTo } : {}),
      }),
      signal: createTimeoutSignal(environment.EMAIL_TIMEOUT_MS),
    })

    if (!response.ok) {
      // Provider error bodies are deliberately never read or retained.
      throw new EmailTransportError("provider_rejected", response.status)
    }

    return {
      providerStatus: response.status,
      providerMessageId: await readProviderMessageId(response),
    }
  } catch (error: unknown) {
    if (error instanceof EmailTransportError) {
      throw error
    }

    throw new EmailTransportError("request_failed")
  }
}

/**
 * Explains a provider rejection in terms an operator can act on.
 *
 * The transport deliberately never reads provider error bodies, so the HTTP
 * status is all the signal there is. These are the statuses Resend actually
 * uses, and each one has a different fix.
 *
 * @param status - Provider HTTP status, when a request was rejected.
 * @returns A user-safe sentence naming the likely misconfiguration.
 */
export function describeResendRejection(status: number | null): string {
  switch (status) {
    case 401:
    case 403:
      return (
        "The email provider refused the request. This usually means " +
        "RESEND_FROM_EMAIL is still a sandbox sender such as " +
        "onboarding@resend.dev, which can only deliver to the Resend " +
        "account owner, or the sending domain is not verified."
      )
    case 422:
      return (
        "The email provider rejected the message. Check that " +
        "RESEND_FROM_EMAIL is a verified sender and the recipient address " +
        "is valid."
      )
    case 429:
      return "The email provider is rate limiting this account. Try again shortly."
    default:
      return "Check the Resend configuration and try again."
  }
}

async function readProviderMessageId(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()

    if (
      body !== null &&
      typeof body === "object" &&
      "id" in body &&
      typeof body.id === "string"
    ) {
      return body.id
    }

    return null
  } catch {
    return null
  }
}
