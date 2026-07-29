import type { AiModelReference, AiProviderId } from "@/services/ai/contracts"

export const AI_PROVIDER_ERROR_CODES = {
  AUTHENTICATION_FAILED: "authentication_failed",
  PERMISSION_DENIED: "permission_denied",
  RATE_LIMITED: "rate_limited",
  REQUEST_TIMEOUT: "request_timeout",
  MODEL_NOT_FOUND: "model_not_found",
  INVALID_REQUEST: "invalid_request",
  UPSTREAM_UNAVAILABLE: "upstream_unavailable",
  NETWORK_ERROR: "network_error",
  INVALID_RESPONSE: "invalid_response",
  UNKNOWN: "unknown",
} as const

/** Stable machine-readable error code exposed by provider adapters. */
export type AiProviderErrorCode =
  (typeof AI_PROVIDER_ERROR_CODES)[keyof typeof AI_PROVIDER_ERROR_CODES]

export type AiProviderErrorOptions = {
  code: AiProviderErrorCode
  message: string
  model: AiModelReference
  provider: AiProviderId
  retryable: boolean
  statusCode: number | null
  traceId: string
  cause?: unknown
}

/** Typed failure raised at the provider boundary. */
export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode
  readonly model: AiModelReference
  readonly provider: AiProviderId
  readonly retryable: boolean
  readonly statusCode: number | null
  readonly traceId: string
  override readonly cause: unknown

  /**
   * Creates a provider failure with stable diagnostic metadata.
   *
   * @param options - Error code, model, trace, retryability, and optional cause.
   */
  constructor(options: AiProviderErrorOptions) {
    super(options.message)
    this.name = "AiProviderError"
    this.code = options.code
    this.model = options.model
    this.provider = options.provider
    this.retryable = options.retryable
    this.statusCode = options.statusCode
    this.traceId = options.traceId
    this.cause = options.cause
  }
}
