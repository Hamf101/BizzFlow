import { GoogleGenAI, type Interactions } from "@google/genai"

import type {
  AiEffort,
  AiProvider,
  AiStructuredGenerationRequest,
  AiStructuredGenerationResult,
  AiTokenUsage,
} from "@/services/ai/contracts"
import {
  AiProviderError,
  assertModelBelongsTo,
  classifyProviderFailure,
  createProviderError,
  UNUSABLE_RESPONSE,
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
  /** Gemini's thinking level; defaults to low. */
  effort?: AiEffort
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

  private readonly effort: AiEffort
  private readonly executeInteraction: GeminiInteractionExecutor
  private readonly timeoutMs: number

  /**
   * Creates a Gemini provider backed by the stable Interactions API.
   *
   * @param options - API credential, timeout, and optional test executor.
   */
  constructor(options: GeminiAiProviderOptions) {
    this.effort = options.effort ?? "low"
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
    assertModelBelongsTo(request, this.id)

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
            thinking_level: this.effort,
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
        throw createProviderError({
          failure: UNUSABLE_RESPONSE,
          provider: this.id,
          request,
          traceId: response.id || null,
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
    cachedTokens: readOptionalCount(usage?.total_cached_tokens),
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

  return createProviderError({
    cause: error,
    failure: classifyProviderFailure(statusCode, details.name),
    provider: GEMINI_PROVIDER_ID,
    request,
    statusCode,
    traceId: readUpstreamTraceId(details.headers),
  })
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
