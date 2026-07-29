import { afterEach, describe, expect, it } from "vitest"

import { createAiRuntime } from "@/services/ai/provider-factory"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("AI provider factory", () => {
  it("constructs the registered provider with the exact configured model", () => {
    process.env = {
      NODE_ENV: "test",
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-exact-runtime-model",
      AI_TIMEOUT_MS: "14000",
      GEMINI_API_KEY: "test-provider-key",
    }

    const runtime = createAiRuntime()

    expect(runtime.provider.id).toBe("gemini")
    expect(runtime.model).toEqual({
      provider: "gemini",
      model: "gemini-exact-runtime-model",
    })
  })

  it("rejects an unregistered provider without falling back", () => {
    process.env = {
      NODE_ENV: "test",
      AI_PROVIDER: "future-provider",
      AI_MODEL: "future-model-v1",
      AI_TIMEOUT_MS: "14000",
    }

    expect(() => createAiRuntime()).toThrow(
      "Unsupported AI provider: future-provider"
    )
  })
})
