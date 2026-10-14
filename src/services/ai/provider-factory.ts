import { getAiEnv, getAiProviderKey, type AiEnv } from "@/lib/env"
import { APPROVED_AI_MODELS } from "@/services/ai/approved-models"
import type { AiEffort, AiProvider, AiRuntime } from "@/services/ai/contracts"
import { GeminiAiProvider } from "@/services/ai/gemini-provider"
import { OpenRouterAiProvider } from "@/services/ai/openrouter-provider"
import { createReplayProvider, recordTo, REPLAY_PROVIDER_ID } from "@/services/ai/replay-provider"

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
 * @param options - `model`: the approved model a member picked, which wins over
 *   AI_PROVIDER/AI_MODEL. `requireApproved: false` lets the benchmark try others.
 * @returns Configured provider adapter and exact provider/model reference.
 * @throws Error when the provider is not registered or the model not approved.
 */
export function createAiRuntime(options: { model?: string; requireApproved?: boolean } = {}): AiRuntime {
  const config = getAiEnv()
  const model = options.model ?? config.AI_MODEL

  // Replay never reaches a vendor, so it serves whichever model is asked for.
  if (config.AI_PROVIDER === REPLAY_PROVIDER_ID) {
    return {
      provider: createReplayProvider(config.AI_REPLAY_FILE),
      model: { provider: REPLAY_PROVIDER_ID, model },
    }
  }

  const approved = APPROVED_AI_MODELS.find(
    (candidate) =>
      candidate.model === model && (options.model !== undefined || candidate.provider === config.AI_PROVIDER)
  )
  const provider = approved?.provider ?? config.AI_PROVIDER
  const createProvider = AI_PROVIDER_FACTORIES[provider]

  if (!createProvider) {
    throw new Error(`Unsupported AI provider: ${provider}`)
  }

  if (!approved && (options.model !== undefined || options.requireApproved !== false)) {
    throw new Error(`AI model ${provider}/${model} is not approved for Flow.`)
  }

  const real = createProvider(config, config.AI_EFFORT ?? approved?.effort ?? "low")

  return {
    provider: config.AI_RECORD_FILE ? recordTo(config.AI_RECORD_FILE, real) : real,
    model: { provider, model },
  }
}
