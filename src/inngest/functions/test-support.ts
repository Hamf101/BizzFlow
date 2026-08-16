import type { BackgroundStepRunner } from "@/inngest/functions/shared"

/** Durable-step double that records the step ids a handler ran. */
export type RecordingStep = BackgroundStepRunner & {
  readonly stepIds: string[]
}

/**
 * Builds a step runner that executes each step inline and records its id.
 *
 * The real executor memoizes steps across attempts; a handler thin enough to be
 * correct only needs the step to run once and return its value, so the double
 * stays a plain object instead of a mocked SDK.
 *
 * @returns Step runner exposing the ids it was asked to run, in order.
 */
export function createRecordingStep(): RecordingStep {
  const stepIds: string[] = []
  const run = async <TResult>(
    stepId: string,
    operation: () => Promise<TResult>
  ): Promise<TResult> => {
    stepIds.push(stepId)
    return operation()
  }

  return { stepIds, run }
}
