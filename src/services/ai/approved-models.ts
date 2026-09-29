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
  // Flow's model before the benchmark existed; kept until the baseline is judged.
  { provider: "gemini", model: "gemini-3.6-flash", effort: "low" },
]
