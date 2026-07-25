import type { EmailJsEnv } from "@/lib/env"
import {
  createEmailJsRateLimiter,
  type ReserveEmailJsSendSlot,
} from "@/services/email/emailjs-rate-limiter"

const EMAILJS_SEND_ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send"
const reserveEmailJsSendSlot = createEmailJsRateLimiter(1000)

/** Provider-neutral email content rendered by the shared EmailJS template. */
export type EmailJsEmailPayload = {
  toEmail: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

/** A single EmailJS delivery request with an internal trace reference. */
export type SendEmailJsEmailInput = {
  deliveryReference: string
  payload: EmailJsEmailPayload
}

/** Successful EmailJS delivery metadata safe for application logs. */
export type SendEmailJsEmailResult = {
  providerStatus: number
}

/** Injectable EmailJS transport contract used by business email services. */
export type EmailJsTransport = (
  input: SendEmailJsEmailInput,
  environment: EmailJsEnv
) => Promise<SendEmailJsEmailResult>

export type EmailJsTransportErrorKind =
  | "invalid_delivery_reference"
  | "provider_rejected"
  | "request_failed"

export type EmailJsTransportDeps = {
  fetcher?: typeof fetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
  reserveSendSlot?: ReserveEmailJsSendSlot
}

/**
 * Error raised when the shared EmailJS transport cannot accept or deliver a request.
 */
export class EmailJsTransportError extends Error {
  readonly kind: EmailJsTransportErrorKind
  readonly providerStatus: number | null

  /**
   * Creates a normalized transport failure without retaining provider response data.
   *
   * @param kind - Stable failure category for safe domain-level logging.
   * @param providerStatus - EmailJS HTTP status when the provider rejected a request.
   */
  constructor(
    kind: EmailJsTransportErrorKind,
    providerStatus: number | null = null
  ) {
    super("EmailJS delivery failed.")
    this.name = "EmailJsTransportError"
    this.kind = kind
    this.providerStatus = providerStatus
  }
}

/**
 * Sends one server-side email through the configured EmailJS dynamic template.
 *
 * @param input - Internal delivery reference and escaped email content.
 * @param environment - Validated EmailJS service, template, keys, and timeout.
 * @param deps - Optional fetch and timeout-signal implementations for tests.
 * @returns The successful provider HTTP status.
 * @throws EmailJsTransportError when the reference, provider response, or request fails.
 */
export async function sendEmailJsEmail(
  input: SendEmailJsEmailInput,
  environment: EmailJsEnv,
  deps: EmailJsTransportDeps = {}
): Promise<SendEmailJsEmailResult> {
  validateDeliveryReference(input.deliveryReference)

  const fetcher = deps.fetcher ?? globalThis.fetch
  const createTimeoutSignal =
    deps.createTimeoutSignal ??
    ((timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs))
  const reserveSendSlot = deps.reserveSendSlot ?? reserveEmailJsSendSlot

  try {
    await reserveSendSlot()
    const response = await fetcher(EMAILJS_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service_id: environment.EMAILJS_SERVICE_ID,
        template_id: environment.EMAILJS_TEMPLATE_ID,
        user_id: environment.EMAILJS_PUBLIC_KEY,
        ...(environment.EMAILJS_PRIVATE_KEY
          ? { accessToken: environment.EMAILJS_PRIVATE_KEY }
          : {}),
        template_params: {
          to_email: input.payload.toEmail,
          subject: input.payload.subject,
          html: input.payload.html,
          text: input.payload.text,
          reply_to: input.payload.replyTo ?? "",
          delivery_reference: input.deliveryReference,
        },
      }),
      signal: createTimeoutSignal(environment.EMAILJS_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new EmailJsTransportError("provider_rejected", response.status)
    }

    return { providerStatus: response.status }
  } catch (error: unknown) {
    if (error instanceof EmailJsTransportError) {
      throw error
    }

    throw new EmailJsTransportError("request_failed")
  }
}

function validateDeliveryReference(deliveryReference: string): void {
  if (
    deliveryReference.length === 0 ||
    deliveryReference.length > 256 ||
    !/^[\x20-\x7e]+$/.test(deliveryReference)
  ) {
    throw new EmailJsTransportError("invalid_delivery_reference")
  }
}
