import { NonRetriableError } from "inngest"

import { TaskServiceError } from "@/services/task-service"

/**
 * The durable-step surface a background handler is allowed to touch.
 *
 * Narrowing the run context to the one tool these edges use keeps them thin and
 * lets tests drive a handler with a plain object instead of a live Inngest run.
 */
export type BackgroundStepRunner = {
  run: <TResult>(
    stepId: string,
    operation: () => Promise<TResult>
  ) => Promise<TResult>
}

/**
 * Runs one service call as a durable step and translates its rejection.
 *
 * Service errors carry an HTTP-style status. Anything below 500 is a rejected
 * request that will fail identically on every attempt, so it is re-thrown as
 * non-retriable rather than burning the function's retry budget; 5xx and
 * unexpected failures stay retriable.
 *
 * @param step - Durable step tooling taken from the run context.
 * @param stepId - Stable step identifier used to memoize a completed call.
 * @param operation - Service call to run inside the step.
 * @returns Value the service produced.
 * @throws NonRetriableError for a rejected request, the original error otherwise.
 */
export async function runBackgroundStep<TResult>(
  step: BackgroundStepRunner,
  stepId: string,
  operation: () => Promise<TResult>
): Promise<TResult> {
  return step.run(stepId, async (): Promise<TResult> => {
    try {
      return await operation()
    } catch (error: unknown) {
      throw toBackgroundStepError(error)
    }
  })
}

function toBackgroundStepError(error: unknown): Error {
  if (error instanceof TaskServiceError && error.statusCode < 500) {
    return new NonRetriableError(error.message, { cause: error })
  }

  return error instanceof Error
    ? error
    : new Error("Background step failed for an unknown reason.")
}
