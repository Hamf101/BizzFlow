import { GoogleGenAI, type Interactions } from "@google/genai"

import type {
  AiProvider,
  AiStructuredGenerationRequest,
  AiStructuredGenerationResult,
  AiTokenUsage,
} from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
  type AiProviderErrorCode,
} from "@/services/ai/errors"

const GEMINI_PROVIDER_ID = "gemini" as const
const GEMINI_STABLE_API_VERSION = "v1"

type GeminiInteractionResponse = Pick<
  Interactions.Interaction,
  "id" | "model" | "output_text" | "status" | "usage"
>

type GeminiInteractionRequestOptions = {
  timeout: number
  maxRetries: number
}

export type GeminiInteractionExecutor = (
  request: Interactions.CreateModelInteractionParamsNonStreaming,
  options: GeminiInteractionRequestOptions
) => Promise<GeminiInteractionResponse>

export type GeminiAiProviderOptions = {
  apiKey: string
  timeoutMs: number
  executeInteraction?: GeminiInteractionExecutor
}

type UpstreamErrorDetails = {
  headers?: Headers | Record<string, string>
  name?: string
  status?: number
  statusCode?: number
}

/** Official Google Gen AI SDK adapter for Gemini Interactions. */
export class GeminiAiProvider implements AiProvider {
  readonly id = GEMINI_PROVIDER_ID

  private readonly executeInteraction: GeminiInteractionExecutor
  private readonly timeoutMs: number

  /**
   * Creates a Gemini provider backed by the stable Interactions API.
   *
   * @param options - API credential, timeout, and optional test executor.
   */
  constructor(options: GeminiAiProviderOptions) {
    this.timeoutMs = options.timeoutMs
    this.executeInteraction =
      options.executeInteraction ?? createSdkInteractionExecutor(options.apiKey)
  }

  /**
   * Performs exactly one schema-constrained Gemini interaction.
   *
   * Automatic SDK retries are disabled so the application-level call budget is
   * explicit. A service may issue a separate, bounded semantic repair request.
   *
   * @param request - Provider-neutral structured generation request.
   * @returns Text, exact model reference, usage, and provider trace identifier.
   * @throws AiProviderError when Gemini rejects or cannot complete the request.
   */
  async generateStructured(
    request: AiStructuredGenerationRequest
  ): Promise<AiStructuredGenerationResult> {
    if (request.model.provider !== this.id) {
      throw new AiProviderError({
        code: AI_PROVIDER_ERROR_CODES.INVALID_REQUEST,
        message: "The AI model does not belong to this provider.",
        model: request.model,
        provider: this.id,
        retryable: false,
        statusCode: null,
        traceId: request.traceId,
      })
    }

    try {
      const response = await this.executeInteraction(
        {
          model: request.model.model,
          input: request.input,
          system_instruction: request.systemInstruction,
          store: false,
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: request.responseSchema,
          },
          generation_config: {
            max_output_tokens: request.maxOutputTokens,
            thinking_level: "low",
            thinking_summaries: "none",
          },
        },
        {
          timeout: this.timeoutMs,
          maxRetries: 0,
        }
      )

      if (
        response.status !== "completed" ||
        typeof response.output_text !== "string" ||
        response.output_text.trim().length === 0
      ) {
        throw new AiProviderError({
          code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
          message: "The AI provider did not return usable structured text.",
          model: request.model,
          provider: this.id,
          retryable: false,
          statusCode: null,
          traceId: response.id || request.traceId,
        })
      }

      return {
        model: request.model,
        text: response.output_text,
        traceId: response.id || request.traceId,
        upstreamCalls: 1,
        usage: readGeminiUsage(response.usage),
      }
    } catch (error: unknown) {
      if (error instanceof AiProviderError) {
        throw error
      }

      throw mapGeminiError(error, request)
    }
  }
}

function createSdkInteractionExecutor(
  apiKey: string
): GeminiInteractionExecutor {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: GEMINI_STABLE_API_VERSION,
    },
  })

  return async (
    request: Interactions.CreateModelInteractionParamsNonStreaming,
    options: GeminiInteractionRequestOptions
  ): Promise<GeminiInteractionResponse> =>
    client.interactions.create({ ...request, stream: false }, options)
}

function readGeminiUsage(
  usage: Interactions.Interaction["usage"]
): AiTokenUsage {
  return {
    inputTokens: readOptionalCount(usage?.total_input_tokens),
    outputTokens: readOptionalCount(usage?.total_output_tokens),
    totalTokens: readOptionalCount(usage?.total_tokens),
  }
}

function readOptionalCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function mapGeminiError(
  error: unknown,
  request: AiStructuredGenerationRequest
): AiProviderError {
  const details = readUpstreamErrorDetails(error)
  const statusCode = details.status ?? details.statusCode ?? null
  const classification = classifyGeminiError(statusCode, details.name)

  return new AiProviderError({
    code: classification.code,
    message: classification.message,
    model: request.model,
    provider: GEMINI_PROVIDER_ID,
    retryable: classification.retryable,
    statusCode,
    traceId: readUpstreamTraceId(details.headers) ?? request.traceId,
    cause: error,
  })
}

function classifyGeminiError(
  statusCode: number | null,
  errorName: string | undefined
): {
  code: AiProviderErrorCode
  message: string
  retryable: boolean
} {
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

      if (
        errorName === "APIConnectionError" ||
        errorName === "TypeError"
      ) {
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

function readUpstreamErrorDetails(error: unknown): UpstreamErrorDetails {
  if (typeof error !== "object" || error === null) {
    return {}
  }

  return error as UpstreamErrorDetails
}

function readUpstreamTraceId(
  headers: Headers | Record<string, string> | undefined
): string | null {
  if (headers instanceof Headers) {
    return (
      headers.get("x-request-id") ??
      headers.get("x-goog-request-id") ??
      headers.get("x-guploader-uploadid")
    )
  }

  if (headers === undefined) {
    return null
  }

  return (
    headers["x-request-id"] ??
    headers["x-goog-request-id"] ??
    headers["x-guploader-uploadid"] ??
    null
  )
}
