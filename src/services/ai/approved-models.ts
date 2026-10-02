import type { AiEffort } from "@/services/ai/contracts"

/**
 * The models Flow may use, each with the reasoning effort it runs at. A model
 * joins only after a benchmark run (scripts/flow-bench) shows its documents
 * are good enough; anything else is refused at startup rather than tried.
 */
export const APPROVED_AI_MODELS: ReadonlyArray<{
  provider: string
  model: string
  effort: AiEffort
}> = [
  // Google's alias for its newest Flash release, and the default. Google swaps
  // the model behind it on each release, so Flow follows without a change here.
  { provider: "gemini", model: "gemini-flash-latest", effort: "low" },
  // One fixed version, to pin AI_MODEL to if a new release behind the alias
  // writes worse documents.
  { provider: "gemini", model: "gemini-3.6-flash", effort: "low" },
]
