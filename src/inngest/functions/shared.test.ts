import { NonRetriableError } from "inngest"
import { describe, expect, it } from "vitest"

import { runBackgroundStep } from "@/inngest/functions/shared"
import { createRecordingStep } from "@/inngest/functions/test-support"
import { TaskServiceError } from "@/services/task-service"

describe("runBackgroundStep", () => {
  it("runs the operation under the given step id and returns its value", async () => {
    const step = createRecordingStep()

    await expect(
      runBackgroundStep(step, "do-the-thing", async (): Promise<string> => "ok")
    ).resolves.toBe("ok")
    expect(step.stepIds).toEqual(["do-the-thing"])
  })

  it("stops retrying a rejected request and keeps its cause", async () => {
    const rejection = new TaskServiceError("Task was not found.", 404)

    const failure = await runBackgroundStep(
      createRecordingStep(),
      "do-the-thing",
      async (): Promise<never> => {
        throw rejection
      }
    ).catch((error: unknown): unknown => error)

    expect(failure).toBeInstanceOf(NonRetriableError)
    expect((failure as NonRetriableError).message).toBe("Task was not found.")
    expect((failure as NonRetriableError).cause).toBe(rejection)
  })

  it("leaves a server-side service failure retriable", async () => {
    const rejection = new TaskServiceError("Unable to load due reminders.", 500)

    await expect(
      runBackgroundStep(
        createRecordingStep(),
        "do-the-thing",
        async (): Promise<never> => {
          throw rejection
        }
      )
    ).rejects.toBe(rejection)
  })

  it("normalizes a non-error rejection without leaking its value", async () => {
    const failure = await runBackgroundStep(
      createRecordingStep(),
      "do-the-thing",
      async (): Promise<never> => {
        throw "raw provider payload"
      }
    ).catch((error: unknown): unknown => error)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(NonRetriableError)
    expect((failure as Error).message).toBe(
      "Background step failed for an unknown reason."
    )
  })
})
