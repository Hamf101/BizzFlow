import type { AiModelReference, AiProviderId } from "@/services/ai/contracts"

export const AI_PROVIDER_ERROR_CODES = {
  AUTHENTICATION_FAILED: "authentication_failed",
  PERMISSION_DENIED: "permission_denied",
  RATE_LIMITED: "rate_limited",
  INSUFFICIENT_CREDITS: "insufficient_credits",
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

/** What a failed upstream call means, whichever provider made it. */
export type ProviderFailureClassification = {
  code: AiProviderErrorCode
  message: string
  retryable: boolean
}

/**
 * Classifies an upstream failure from its HTTP status and error name, so
 * every adapter reports the same codes for the same failures.
 *
 * @param statusCode - HTTP status the provider answered with, if any.
 * @param errorName - Name of the thrown error, for timeouts and network failures.
 * @returns Stable code, a message safe to log, and whether a retry may help.
 */
export function classifyProviderFailure(
  statusCode: number | null,
  errorName: string | undefined
): ProviderFailureClassification {
  if (
    statusCode === 408 ||
    errorName === "APIConnectionTimeoutError" ||
    errorName === "TimeoutError"
  ) {
    return {
      code: AI_PROVIDER_ERROR_CODES.REQUEST_TIMEOUT,
      message: "The AI provider request timed out.",
      retryable: true,
    }
  }

  switch (statusCode) {
    case 400:
    case 409:
    case 422:
      return {
        code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
        message: "The AI provider rejected the request.",
        retryable: false,
      }
    case 401:
      return {
        code: AI_PROVIDER_ERROR_CODES.AUTHENTICATION_FAILED,
        message: "The AI provider credential was rejected.",
        retryable: false,
      }
    case 402:
      return {
        code: AI_PROVIDER_ERROR_CODES.INSUFFICIENT_CREDITS,
        message: "The AI provider account has run out of credit.",
        retryable: false,
      }
    case 403:
      return {
        code: AI_PROVIDER_ERROR_CODES.PERMISSION_DENIED,
        message: "The AI provider denied the request.",
        retryable: false,
      }
    case 404:
      return {
        code: AI_PROVIDER_ERROR_CODES.MODEL_NOT_FOUND,
        message: "The configured AI model was not found.",
        retryable: false,
      }
    case 429:
      return {
        code: AI_PROVIDER_ERROR_CODES.RATE_LIMITED,
        message: "The AI provider rate limit was reached.",
        retryable: true,
      }
    default:
      if (statusCode !== null && statusCode >= 500) {
        return {
          code: AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE,
          message: "The AI provider is temporarily unavailable.",
          retryable: true,
        }
      }

      if (errorName === "APIConnectionError" || errorName === "TypeError") {
        return {
          code: AI_PROVIDER_ERROR_CODES.NETWORK_ERROR,
          message: "The AI provider could not be reached.",
          retryable: true,
        }
      }

      return {
        code: AI_PROVIDER_ERROR_CODES.UNKNOWN,
        message: "The AI provider request failed.",
        retryable: false,
      }
  }
}

/**
 * Builds the typed failure an adapter throws for one request.
 *
 * @param input - The request, the adapter, what went wrong, and any upstream detail.
 * @returns A provider error carrying the request's model and trace.
 */
export function createProviderError(input: {
  request: { model: AiModelReference; traceId: string }
  provider: AiProviderId
  failure: ProviderFailureClassification
  statusCode?: number | null
  traceId?: string | null
  cause?: unknown
}): AiProviderError {
  return new AiProviderError({
    ...input.failure,
    cause: input.cause,
    model: input.request.model,
    provider: input.provider,
    statusCode: input.statusCode ?? null,
    traceId: input.traceId ?? input.request.traceId,
  })
}

/**
 * Refuses a request meant for another provider's model, so a misrouted call
 * never reaches the wrong vendor.
 *
 * @param request - The request about to be sent.
 * @param provider - The adapter's provider id.
 * @throws AiProviderError when the model belongs to another provider.
 */
export function assertModelBelongsTo(
  request: { model: AiModelReference; traceId: string },
  provider: AiProviderId
): void {
  if (request.model.provider !== provider) {
    throw createProviderError({
      failure: {
        code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
        message: "The AI model does not belong to this provider.",
        retryable: false,
      },
      provider,
      request,
    })
  }
}

/** The failure for an answer with no usable structured text. */
export const UNUSABLE_RESPONSE: ProviderFailureClassification = {
  code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
  message: "The AI provider did not return usable structured text.",
  retryable: false,
}
