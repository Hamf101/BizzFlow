import { afterEach, describe, expect, it } from "vitest"

import { createAiRuntime } from "@/services/ai/provider-factory"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("AI provider factory", () => {
  it("runs with no model configured, on the approved model that follows Gemini's newest", () => {
    process.env = {
      NODE_ENV: "test",
      AI_TIMEOUT_MS: "14000",
      GEMINI_API_KEY: "test-provider-key",
    }

    const runtime = createAiRuntime()

    expect(runtime.provider.id).toBe("gemini")
    expect(runtime.model).toEqual({ provider: "gemini", model: "gemini-flash-latest" })
  })

  it("refuses a model the benchmark has not approved, unless a benchmark asks for it", () => {
    process.env = {
      NODE_ENV: "test",
      AI_PROVIDER: "openrouter",
      AI_MODEL: "vendor/untested-model",
      OPENROUTER_API_KEY: "test-provider-key",
    }

    expect(() => createAiRuntime()).toThrow("not approved")
    expect(createAiRuntime({ requireApproved: false }).model).toEqual({
      provider: "openrouter",
      model: "vendor/untested-model",
    })
  })

  it("rejects an unregistered provider without falling back", () => {
    process.env = {
      NODE_ENV: "test",
      AI_PROVIDER: "future-provider",
      AI_MODEL: "future-model-v1",
      AI_TIMEOUT_MS: "14000",
    }

    expect(() => createAiRuntime({ requireApproved: false })).toThrow(
      "Unsupported AI provider: future-provider"
    )
  })
})
