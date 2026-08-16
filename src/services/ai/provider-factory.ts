import { getAiEnv, getGeminiEnv, type AiEnv } from "@/lib/env"
import type { AiRuntime } from "@/services/ai/contracts"
import { GeminiAiProvider } from "@/services/ai/gemini-provider"

type AiRuntimeFactory = (config: AiEnv) => AiRuntime

const AI_RUNTIME_FACTORIES: Readonly<Record<string, AiRuntimeFactory>> = {
  gemini: createGeminiRuntime,
}

/**
 * Reads configuration and creates the enabled AI runtime.
 *
 * Provider registration is isolated at this infrastructure edge. Unknown
 * runtime values are rejected instead of selecting an implicit provider.
 *
 * @returns Configured provider adapter and exact provider/model reference.
 * @throws Error when the provider is not registered.
 */
export function createAiRuntime(): AiRuntime {
  const config = getAiEnv()
  const createRuntime = AI_RUNTIME_FACTORIES[config.AI_PROVIDER]

  if (!createRuntime) {
    throw new Error(`Unsupported AI provider: ${config.AI_PROVIDER}`)
  }

  return createRuntime(config)
}

function createGeminiRuntime(config: AiEnv): AiRuntime {
  const geminiEnv = getGeminiEnv()

  return {
    provider: new GeminiAiProvider({
      apiKey: geminiEnv.GEMINI_API_KEY,
      timeoutMs: config.AI_TIMEOUT_MS,
    }),
    model: {
      provider: config.AI_PROVIDER,
      model: config.AI_MODEL,
    },
  }
}
