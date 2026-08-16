import { NonRetriableError } from "inngest"
import { describe, expect, it, vi } from "vitest"

import {
  DUE_TASK_REMINDER_CRON,
  handleDueTaskReminders,
  processDueRemindersFunction,
} from "@/inngest/functions/process-due-reminders"
import { createRecordingStep } from "@/inngest/functions/test-support"
import {
  TaskServiceError,
  type TaskReminderRunSummary,
} from "@/services/task-service"

const SUMMARY: TaskReminderRunSummary = {
  scannedCount: 4,
  sentCount: 3,
  failedCount: 1,
  retryingCount: 0,
  skippedCount: 0,
}

describe("handleDueTaskReminders", () => {
  it("returns the service summary from one named durable step", async () => {
    const processDueTaskReminders = vi.fn(
      async (): Promise<TaskReminderRunSummary> => SUMMARY
    )
    const step = createRecordingStep()

    await expect(
      handleDueTaskReminders({ step }, { processDueTaskReminders })
    ).resolves.toEqual(SUMMARY)
    expect(processDueTaskReminders).toHaveBeenCalledOnce()
    expect(processDueTaskReminders).toHaveBeenCalledWith()
    expect(step.stepIds).toEqual(["process-due-task-reminders"])
  })

  it("stops retrying when the service rejects the scan", async () => {
    const processDueTaskReminders = vi.fn(async (): Promise<never> => {
      throw new TaskServiceError("Task reminders are not available.", 409)
    })

    await expect(
      handleDueTaskReminders(
        { step: createRecordingStep() },
        { processDueTaskReminders }
      )
    ).rejects.toBeInstanceOf(NonRetriableError)
  })

  it("lets an unexpected service failure retry", async () => {
    const processDueTaskReminders = vi.fn(async (): Promise<never> => {
      throw new TaskServiceError("Unable to load due task reminders.", 500)
    })

    await expect(
      handleDueTaskReminders(
        { step: createRecordingStep() },
        { processDueTaskReminders }
      )
    ).rejects.not.toBeInstanceOf(NonRetriableError)
  })
})

describe("processDueRemindersFunction", () => {
  it("is scheduled every fifteen minutes with one active run", () => {
    expect(processDueRemindersFunction.opts.id).toBe(
      "process-due-task-reminders"
    )
    expect(processDueRemindersFunction.opts.triggers).toEqual([
      { cron: DUE_TASK_REMINDER_CRON },
    ])
    expect(DUE_TASK_REMINDER_CRON).toBe("*/15 * * * *")
    expect(processDueRemindersFunction.opts.concurrency).toBe(1)
  })
})
