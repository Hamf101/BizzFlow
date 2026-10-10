import { describe, expect, it, vi } from "vitest"

import { handleDueTaskReminders } from "@/inngest/functions/process-due-reminders"
import { createRecordingStep } from "@/inngest/functions/test-support"
import type { TaskReminderRunSummary } from "@/services/task-service"
import type { TaskReminder } from "@/types/task"

const SUMMARY: TaskReminderRunSummary = {
  scannedCount: 4,
  sentCount: 3,
  failedCount: 1,
  retryingCount: 0,
  skippedCount: 0,
}

const REMINDERS = [{ id: "reminder-a" }, { id: "reminder-b" }] as TaskReminder[]

function oneSent(): Promise<TaskReminderRunSummary> {
  return Promise.resolve({ ...SUMMARY, scannedCount: 1, sentCount: 1, failedCount: 0 })
}

describe("handleDueTaskReminders", () => {
  it("delivers each due reminder in its own durable step and sums the outcomes", async () => {
    // One step per reminder: a run killed mid-batch replays only the reminder
    // in flight, never sends already memoized.
    const deliverDueTaskReminders = vi.fn(oneSent)
    const step = createRecordingStep()

    await expect(
      handleDueTaskReminders(
        { step },
        { findDueTaskReminders: async () => REMINDERS, deliverDueTaskReminders }
      )
    ).resolves.toEqual({ ...SUMMARY, scannedCount: 2, sentCount: 2, failedCount: 0 })
    expect(step.stepIds).toEqual([
      "find-due-task-reminders",
      "deliver-task-reminder-reminder-a",
      "deliver-task-reminder-reminder-b",
    ])
    expect(deliverDueTaskReminders).toHaveBeenNthCalledWith(2, [REMINDERS[1]])
  })
})
