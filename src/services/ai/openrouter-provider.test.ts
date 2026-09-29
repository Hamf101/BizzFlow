import { describe, expect, it, vi } from "vitest"

import type { AiStructuredGenerationRequest } from "@/services/ai/contracts"
import { AI_PROVIDER_ERROR_CODES, AiProviderError } from "@/services/ai/errors"
import { OpenRouterAiProvider } from "@/services/ai/openrouter-provider"

const SCHEMA = {
  type: "object",
  properties: { result: { type: "string" } },
  required: ["result"],
  additionalProperties: false,
}

function createRequest(): AiStructuredGenerationRequest {
  return {
    input: '{"request":"create an agreement"}',
    maxOutputTokens: 2_048,
    model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" },
    responseSchema: SCHEMA,
    systemInstruction: "Return the requested structured response.",
    traceId: "trace-1",
  }
}

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }))
}

async function failure(fetchStub: typeof fetch): Promise<AiProviderError> {
  const provider = new OpenRouterAiProvider({ apiKey: "key", fetch: fetchStub, timeoutMs: 5_000 })

  return provider.generateStructured(createRequest()).then(
    () => {
      throw new Error("expected a failure")
    },
    (error: unknown) => error as AiProviderError
  )
}

describe("OpenRouter AI provider", () => {
  it("asks for strict JSON from only endpoints that honour it, and reads text and usage", async () => {
    const fetch = respond(200, {
      id: "gen-1",
      choices: [{ finish_reason: "stop", message: { content: '{"result":"ok"}' } }],
      usage: { completion_tokens: 30, prompt_tokens: 120, prompt_tokens_details: { cached_tokens: 64 }, total_tokens: 150 },
    })
    const provider = new OpenRouterAiProvider({ apiKey: "key", effort: "medium", fetch, timeoutMs: 5_000 })

    const result = await provider.generateStructured(createRequest())
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? []

    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer key")
    expect(JSON.parse(String(init?.body))).toEqual({
      max_tokens: 2_048,
      messages: [
        { content: "Return the requested structured response.", role: "system" },
        { content: '{"request":"create an agreement"}', role: "user" },
      ],
      model: "anthropic/claude-sonnet-5.5",
      provider: { require_parameters: true },
      reasoning: { effort: "medium", exclude: true },
      response_format: { json_schema: { name: "response", schema: SCHEMA, strict: true }, type: "json_schema" },
    })
    expect(result).toEqual({
      model: { provider: "openrouter", model: "anthropic/claude-sonnet-5.5" },
      text: '{"result":"ok"}',
      traceId: "gen-1",
      upstreamCalls: 1,
      usage: { cachedTokens: 64, inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    })
  })

  it("classifies rate limits, spent credit and outages, including errors inside a 200", async () => {
    await expect(failure(respond(429, { error: { code: 429, message: "slow down" } }))).resolves.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.RATE_LIMITED,
      retryable: true,
    })
    await expect(failure(respond(402, { error: { code: 402, message: "no credit" } }))).resolves.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.INSUFFICIENT_CREDITS,
      retryable: false,
    })
    await expect(failure(respond(200, { error: { code: 502, message: "provider died" } }))).resolves.toMatchObject({
      code: AI_PROVIDER_ERROR_CODES.UPSTREAM_UNAVAILABLE,
      retryable: true,
    })
  })

  it("rejects an answer with no text, such as one cut off by its token limit", async () => {
    await expect(
      failure(respond(200, { choices: [{ finish_reason: "length", message: { content: "" } }] }))
    ).resolves.toMatchObject({ code: AI_PROVIDER_ERROR_CODES.INVALID_RESPONSE })
  })
})
