import type { ResendEnv } from "@/lib/env"

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails"

/** Provider-neutral email content assembled by business email services. */
export type EmailPayload = {
  toEmail: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

/** A single email delivery request with an internal trace reference. */
export type SendEmailInput = {
  deliveryReference: string
  payload: EmailPayload
}

/** Successful delivery metadata safe for application logs. */
export type SendEmailResult = {
  providerStatus: number
  providerMessageId: string | null
}

/** Injectable email transport contract used by business email services. */
export type EmailTransport = (
  input: SendEmailInput,
  environment: ResendEnv
) => Promise<SendEmailResult>

export type EmailTransportErrorKind =
  | "invalid_delivery_reference"
  | "provider_rejected"
  | "request_failed"

export type EmailTransportDeps = {
  fetcher?: typeof fetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
}

/**
 * Error raised when the shared email transport cannot accept or deliver a request.
 */
export class EmailTransportError extends Error {
  readonly kind: EmailTransportErrorKind
  readonly providerStatus: number | null

  /**
   * Creates a normalized transport failure without retaining provider response data.
   *
   * @param kind - Stable failure category for safe domain-level logging.
   * @param providerStatus - Provider HTTP status when a request was rejected.
   */
  constructor(
    kind: EmailTransportErrorKind,
    providerStatus: number | null = null
  ) {
    super("Email delivery failed.")
    this.name = "EmailTransportError"
    this.kind = kind
    this.providerStatus = providerStatus
  }
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
  environment: ResendEnv,
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
      signal: createTimeoutSignal(environment.RESEND_TIMEOUT_MS),
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

function validateDeliveryReference(deliveryReference: string): void {
  if (
    deliveryReference.length === 0 ||
    deliveryReference.length > 256 ||
    !/^[\x20-\x7e]+$/.test(deliveryReference)
  ) {
    throw new EmailTransportError("invalid_delivery_reference")
  }
}
