import { z } from "zod"

import type {
  AiEffort,
  AiProvider,
  AiStructuredGenerationRequest,
  AiStructuredGenerationResult,
} from "@/services/ai/contracts"
import {
  AiProviderError,
  assertModelBelongsTo,
  classifyProviderFailure,
  createProviderError,
  UNUSABLE_RESPONSE,
} from "@/services/ai/errors"

const OPENROUTER_PROVIDER_ID = "openrouter" as const
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"

// Only what this adapter reads. OpenRouter can answer 200 with nothing but an
// error, when a provider fails after the headers were sent.
const completionSchema = z.object({
  id: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }).optional() }))
    .optional(),
  usage: z
    .object({
      completion_tokens: z.number().optional(),
      prompt_tokens: z.number().optional(),
      prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullish(),
      total_tokens: z.number().optional(),
    })
    .nullish(),
  error: z.object({ code: z.number().optional() }).optional(),
})

export type OpenRouterAiProviderOptions = {
  apiKey: string
  timeoutMs: number
  /** Reasoning effort OpenRouter maps to each model's own setting; defaults to low. */
  effort?: AiEffort
  fetch?: typeof fetch
}

/**
 * OpenRouter adapter: one OpenAI-compatible chat completion per call, reaching
 * many vendors' models with one key. Structured output is strict JSON Schema,
 * and `require_parameters` keeps OpenRouter from routing to an endpoint that
 * would ignore the schema.
 */
export class OpenRouterAiProvider implements AiProvider {
  readonly id = OPENROUTER_PROVIDER_ID

  private readonly apiKey: string
  private readonly effort: AiEffort
  private readonly fetch: typeof fetch
  private readonly timeoutMs: number

  /**
   * @param options - API key, timeout, reasoning effort, and an optional fetch for tests.
   */
  constructor(options: OpenRouterAiProviderOptions) {
    this.apiKey = options.apiKey
    this.effort = options.effort ?? "low"
    this.fetch = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs
  }

  /**
   * Performs exactly one schema-constrained completion, with no retries.
   *
   * @param request - Provider-neutral structured generation request.
   * @returns Text, exact model reference, usage, and OpenRouter's generation id.
   * @throws AiProviderError when OpenRouter or the model fails or answers without text.
   */
  async generateStructured(
    request: AiStructuredGenerationRequest
  ): Promise<AiStructuredGenerationResult> {
    assertModelBelongsTo(request, this.id)

    let response: Response

    try {
      response = await this.fetch(OPENROUTER_CHAT_URL, {
        body: JSON.stringify({
          max_tokens: request.maxOutputTokens,
          messages: [
            { content: request.systemInstruction, role: "system" },
            { content: request.input, role: "user" },
          ],
          model: request.model.model,
          provider: { require_parameters: true },
          reasoning: { effort: this.effort, exclude: true },
          response_format: {
            json_schema: { name: "response", schema: request.responseSchema, strict: true },
            type: "json_schema",
          },
        }),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error: unknown) {
      throw this.fail(request, null, error instanceof Error ? error.name : undefined, error)
    }

    const body = completionSchema.safeParse(await response.json().catch(() => null))
    const errorStatus = !response.ok ? response.status : body.success && body.data.error ? (body.data.error.code ?? 502) : null

    if (errorStatus !== null) {
      throw this.fail(request, errorStatus, undefined, body.success ? body.data.error : undefined)
    }

    const text = body.success ? body.data.choices?.[0]?.message?.content : null

    if (!body.success || typeof text !== "string" || text.trim().length === 0) {
      throw createProviderError({ failure: UNUSABLE_RESPONSE, provider: this.id, request })
    }

    const usage = body.data.usage

    return {
      model: request.model,
      text,
      traceId: body.data.id ?? request.traceId,
      upstreamCalls: 1,
      usage: {
        cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
      },
    }
  }

  private fail(
    request: AiStructuredGenerationRequest,
    statusCode: number | null,
    errorName: string | undefined,
    cause: unknown
  ): AiProviderError {
    return createProviderError({
      cause,
      failure: classifyProviderFailure(statusCode, errorName),
      provider: this.id,
      request,
      statusCode,
    })
  }
}
