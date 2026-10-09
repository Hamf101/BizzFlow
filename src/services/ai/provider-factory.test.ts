import { afterEach, describe, expect, it } from "vitest"

import { APPROVED_AI_MODELS } from "@/services/ai/approved-models"
import { createAiRuntime } from "@/services/ai/provider-factory"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("AI provider factory", () => {
  it("runs with no model configured, on the newest approved model", () => {
    process.env = {
      NODE_ENV: "test",
      AI_TIMEOUT_MS: "14000",
      GEMINI_API_KEY: "test-provider-key",
    }

    const runtime = createAiRuntime()

    expect(runtime.provider.id).toBe("gemini")
    expect(runtime.model).toEqual({ provider: "gemini", model: APPROVED_AI_MODELS[0].model })
  })

  it("runs the model a member picked, and refuses one that isn't approved", () => {
    process.env = { NODE_ENV: "test", GEMINI_API_KEY: "test-provider-key" }

    expect(createAiRuntime({ model: "gemini-3.5-flash" }).model).toEqual({
      provider: "gemini",
      model: "gemini-3.5-flash",
    })
    expect(() => createAiRuntime({ model: "gemini-flash-latest" })).toThrow("not approved")
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
