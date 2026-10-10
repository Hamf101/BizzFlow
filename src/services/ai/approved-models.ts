import { z } from "zod"

import type { AiEffort } from "@/services/ai/contracts"

/**
 * The models Flow may use, newest first, each with the reasoning effort it runs
 * at. Members pick one in Flow; the first is the default. A model joins only
 * after a benchmark run (scripts/flow-bench) shows its documents are good
 * enough; anything else is refused rather than tried.
 */
export const APPROVED_AI_MODELS = [
  { provider: "gemini", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", effort: "low" },
  { provider: "gemini", model: "gemini-3.6-flash", label: "Gemini 3.6 Flash", effort: "low" },
  { provider: "gemini", model: "gemini-3.5-flash", label: "Gemini 3.5 Flash", effort: "low" },
] as const satisfies ReadonlyArray<{ provider: string; model: string; label: string; effort: AiEffort }>

export type FlowModelId = (typeof APPROVED_AI_MODELS)[number]["model"]

/** A model a member may pick in Flow. */
export const flowModelSchema = z.enum(
  APPROVED_AI_MODELS.map((candidate) => candidate.model) as [FlowModelId, ...FlowModelId[]],
  { error: "Pick one of the models Flow offers." }
)
