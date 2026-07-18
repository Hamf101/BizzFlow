import type { ResendEnv } from "@/lib/env"

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails"
const MAX_IDEMPOTENCY_KEY_LENGTH = 256

export type ResendEmailPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  reply_to?: string
}

export type SendResendEmailInput = {
  logicalDeliveryId: string
  payload: ResendEmailPayload
}

export type SendResendEmailResult = {
  emailId: string | null
}

export type ResendTransport = (
  input: SendResendEmailInput,
  environment: ResendEnv
) => Promise<SendResendEmailResult>

export type ResendTransportErrorKind =
  | "invalid_delivery_id"
  | "provider_rejected"
  | "request_failed"

export type ResendTransportDeps = {
  fetcher?: typeof fetch
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal
}

/**
 * Error raised when the shared Resend transport cannot accept or deliver a request.
 */
export class ResendTransportError extends Error {
  readonly kind: ResendTransportErrorKind
  readonly providerStatus: number | null

  /**
   * Creates a normalized transport failure without retaining provider response data.
   *
   * @param kind - Stable failure category for safe domain-level logging.
   * @param providerStatus - Resend HTTP status when the provider rejected a request.
   */
  constructor(kind: ResendTransportErrorKind, providerStatus: number | null = null) {
    super("Resend email delivery failed.")
    this.name = "ResendTransportError"
    this.kind = kind
    this.providerStatus = providerStatus
  }
}

/**
 * Sends one email through Resend with a bounded request and retry-safe identity.
 *
 * @param input - Stable delivery identifier and Resend email payload.
 * @param environment - Validated Resend credentials and timeout configuration.
 * @param deps - Optional fetch and timeout-signal implementations for tests.
 * @returns Resend's accepted email identifier when one is returned.
 * @throws ResendTransportError when the identifier, provider response, or request fails.
 */
export async function sendResendEmail(
  input: SendResendEmailInput,
  environment: ResendEnv,
  deps: ResendTransportDeps = {}
): Promise<SendResendEmailResult> {
  validateLogicalDeliveryId(input.logicalDeliveryId)

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
        "Idempotency-Key": input.logicalDeliveryId,
      },
      body: JSON.stringify(input.payload),
      signal: createTimeoutSignal(environment.RESEND_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new ResendTransportError("provider_rejected", response.status)
    }

    return {
      emailId: await readResendEmailId(response),
    }
  } catch (error: unknown) {
    if (error instanceof ResendTransportError) {
      throw error
    }

    throw new ResendTransportError("request_failed")
  }
}

function validateLogicalDeliveryId(logicalDeliveryId: string): void {
  if (
    logicalDeliveryId.length === 0 ||
    logicalDeliveryId.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    !/^[\x20-\x7e]+$/.test(logicalDeliveryId)
  ) {
    throw new ResendTransportError("invalid_delivery_id")
  }
}

async function readResendEmailId(response: Response): Promise<string | null> {
  const responseBody: unknown = await response.json().catch((): null => null)

  if (
    typeof responseBody === "object" &&
    responseBody !== null &&
    "id" in responseBody &&
    typeof responseBody.id === "string"
  ) {
    return responseBody.id
  }

  return null
}
