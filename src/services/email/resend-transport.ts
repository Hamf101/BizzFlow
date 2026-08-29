import type { ResendEmailEnv } from "@/lib/env"
import {
  EmailTransportError,
  validateDeliveryReference,
  type SendEmailInput,
  type SendEmailResult,
} from "@/services/email/contracts"

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails"

// Dormant adapter: the shared transport intentionally does not import this
// module while EmailJS is the pinned transactional provider.

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
