import { getAiEnv, getAiProviderKey, type AiEnv } from "@/lib/env"
import { APPROVED_AI_MODELS } from "@/services/ai/approved-models"
import type { AiEffort, AiProvider, AiRuntime } from "@/services/ai/contracts"
import { GeminiAiProvider } from "@/services/ai/gemini-provider"
import { OpenRouterAiProvider } from "@/services/ai/openrouter-provider"

type AiProviderFactory = (config: AiEnv, effort: AiEffort) => AiProvider

const AI_PROVIDER_FACTORIES: Readonly<Record<string, AiProviderFactory>> = {
  gemini: (config, effort) =>
    new GeminiAiProvider({ apiKey: getAiProviderKey("gemini"), effort, timeoutMs: config.AI_TIMEOUT_MS }),
  openrouter: (config, effort) =>
    new OpenRouterAiProvider({ apiKey: getAiProviderKey("openrouter"), effort, timeoutMs: config.AI_TIMEOUT_MS }),
}

/**
 * Reads configuration and creates the enabled AI runtime.
 *
 * Provider registration is isolated at this infrastructure edge. Unknown
 * providers are rejected instead of selecting an implicit one, and so is any
 * model the benchmark has not approved.
 *
 * @param options - `requireApproved: false` lets the benchmark try unapproved models.
 * @returns Configured provider adapter and exact provider/model reference.
 * @throws Error when the provider is not registered or the model not approved.
 */
export function createAiRuntime(options: { requireApproved?: boolean } = {}): AiRuntime {
  const config = getAiEnv()
  const createProvider = AI_PROVIDER_FACTORIES[config.AI_PROVIDER]

  if (!createProvider) {
    throw new Error(`Unsupported AI provider: ${config.AI_PROVIDER}`)
  }

  const approved = APPROVED_AI_MODELS.find(
    (candidate) => candidate.provider === config.AI_PROVIDER && candidate.model === config.AI_MODEL
  )

  if (!approved && options.requireApproved !== false) {
    throw new Error(`AI model ${config.AI_PROVIDER}/${config.AI_MODEL} is not approved for Flow.`)
  }

  return {
    provider: createProvider(config, config.AI_EFFORT ?? approved?.effort ?? "low"),
    model: {
      provider: config.AI_PROVIDER,
      model: config.AI_MODEL,
    },
  }
}
