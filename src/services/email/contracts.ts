import type { EmailEnv } from "@/lib/env"

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

/** Injectable provider-neutral email transport used by business services. */
export type EmailTransport = (
  input: SendEmailInput,
  environment: EmailEnv
) => Promise<SendEmailResult>

export type EmailTransportErrorKind =
  | "invalid_delivery_reference"
  | "provider_rejected"
  | "request_failed"

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
 * Validates the trace reference sent with an email delivery request.
 *
 * @param deliveryReference - Internal printable-ASCII delivery identifier.
 * @throws EmailTransportError when the reference is empty, too long, or unsafe.
 */
export function validateDeliveryReference(deliveryReference: string): void {
  if (
    deliveryReference.length === 0 ||
    deliveryReference.length > 256 ||
    !/^[\x20-\x7e]+$/.test(deliveryReference)
  ) {
    throw new EmailTransportError("invalid_delivery_reference")
  }
}
