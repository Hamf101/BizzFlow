import { describe, expect, it, vi } from "vitest"

import type { AiStructuredGenerationRequest } from "@/services/ai/contracts"
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
} from "@/services/ai/errors"
import {
  GeminiAiProvider,
  type GeminiInteractionExecutor,
} from "@/services/ai/gemini-provider"

describe("Gemini AI provider", () => {
  it("uses the official stable Interactions contract without storage or retries", async () => {
    const executeInteraction = vi.fn<GeminiInteractionExecutor>(
      async () => ({
        id: "interaction-trace-1",
        model: "gemini-3.6-flash",
        output_text: '{"result":"ok"}',
        status: "completed",
        usage: {
          total_input_tokens: 120,
          total_output_tokens: 30,
          total_tokens: 150,
        },
      })
    )
    const provider = new GeminiAiProvider({
      apiKey: "test-key",
      timeoutMs: 12_000,
      executeInteraction,
    })

    const result = await provider.generateStructured(createRequest())

    expect(executeInteraction).toHaveBeenCalledTimes(1)
    expect(executeInteraction).toHaveBeenCalledWith(
      {
        model: "gemini-3.6-flash",
        input: '{"request":"create an agreement"}',
        system_instruction: "Return the requested structured response.",
        store: false,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: { result: { type: "string" } },
            required: ["result"],
            additionalProperties: false,
          },
        },
        generation_config: {
          max_output_tokens: 2_048,
          thinking_level: "low",
          thinking_summaries: "none",
        },
      },
      {
        timeout: 12_000,
        maxRetries: 0,
      }
    )
    expect(result).toEqual({
      model: {
        provider: "gemini",
        model: "gemini-3.6-flash",
      },
      text: '{"result":"ok"}',
      traceId: "interaction-trace-1",
      upstreamCalls: 1,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
      },
    })
  })

  it("uses only the exact requested model when it is unavailable", async () => {
    const executeInteraction = vi.fn<GeminiInteractionExecutor>(
      async () => {
        throw {
          name: "NotFoundError",
          status: 404,
          headers: new Headers({ "x-request-id": "provider-request-404" }),
        }
      }
    )
    const provider = new GeminiAiProvider({
      apiKey: "test-key",
      timeoutMs: 10_000,
      executeInteraction,
    })
    const request = createRequest("gemini-exact-deployment-model")

    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.MODEL_NOT_FOUND,
      model: request.model,
      provider: "gemini",
      retryable: false,
      statusCode: 404,
      traceId: "provider-request-404",
    })
    expect(executeInteraction).toHaveBeenCalledTimes(1)
    expect(executeInteraction.mock.calls[0]?.[0].model).toBe(
      "gemini-exact-deployment-model"
    )
  })

  it.each([
    {
      status: 401,
      code: AI_PROVIDER_ERROR_CODES.AUTHENTICATION_FAILED,
      retryable: false,
    },
    {
      status: 429,
      code: AI_PROVIDER_ERROR_CODES.RATE_LIMITED,
      retryable: true,
    },
    {
      status: 503,
      code: AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE,
      retryable: true,
    },
  ])(
    "maps HTTP $status to a typed provider error",
    async ({ status, code, retryable }): Promise<void> => {
      const provider = new GeminiAiProvider({
        apiKey: "test-key",
        timeoutMs: 10_000,
        executeInteraction: async (): Promise<never> => {
          throw { name: "ApiError", status }
        },
      })

      const error = await provider
        .generateStructured(createRequest())
        .catch((caught: unknown): unknown => caught)

      expect(error).toBeInstanceOf(AiProviderError)
      expect(error).toMatchObject({
        code,
        retryable,
        statusCode: status,
        traceId: "local-trace-1",
      })
    }
  )

  it("rejects a completed interaction without structured text", async () => {
    const provider = new GeminiAiProvider({
      apiKey: "test-key",
      timeoutMs: 10_000,
      executeInteraction: async () => ({
        id: "empty-output-trace",
        model: "gemini-3.6-flash",
        output_text: "",
        status: "completed",
        usage: undefined,
      }),
    })

    await expect(
      provider.generateStructured(createRequest())
    ).rejects.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE,
      retryable: false,
      traceId: "empty-output-trace",
    })
  })
})

function createRequest(
  model = "gemini-3.6-flash"
): AiStructuredGenerationRequest {
  return {
    model: {
      provider: "gemini",
      model,
    },
    input: '{"request":"create an agreement"}',
    systemInstruction: "Return the requested structured response.",
    responseSchema: {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
      additionalProperties: false,
    },
    maxOutputTokens: 2_048,
    traceId: "local-trace-1",
  }
}
