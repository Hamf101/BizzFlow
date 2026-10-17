import { cron } from "inngest"

import { inngest } from "@/inngest/client"
import { monitorCron } from "@/lib/observability"
import {
  runBackgroundStep,
  type BackgroundStepRunner,
} from "@/inngest/functions/shared"
import {
  deliverDueTaskReminders,
  findDueTaskReminders,
  type TaskReminderRunSummary,
} from "@/services/task-service"
import type { TaskReminder } from "@/types/task"

/** Schedule the due-reminder scan runs on, in UTC. */
export const DUE_TASK_REMINDER_CRON = "*/15 * * * *"

/** Run-context slice the due-reminder handler reads. */
export type DueTaskReminderContext = {
  step: BackgroundStepRunner
}

/** Injectable service surface, so tests never reach a real database. */
export type DueTaskReminderDeps = {
  findDueTaskReminders?: () => Promise<TaskReminder[]>
  deliverDueTaskReminders?: (
    reminders: TaskReminder[]
  ) => Promise<TaskReminderRunSummary>
}

/**
 * Delivers one bounded batch of task reminders whose instant has passed.
 *
 * Every decision — batch size, claiming, delivery, and the failure record —
 * belongs to the service. This edge lists the batch in one durable step and
 * delivers each reminder in its own, so no single step runs a hundred sends
 * past the route's time limit, and a killed run replays only the reminder in
 * flight while every completed send stays memoized.
 *
 * @param context - Run context supplying durable step tooling.
 * @param deps - Optional service overrides used by tests.
 * @returns Counters for the scanned, sent, failed, and skipped reminders.
 * @throws NonRetriableError when the scan is rejected, the service error otherwise.
 */
export async function handleDueTaskReminders(
  { step }: DueTaskReminderContext,
  deps: DueTaskReminderDeps = {}
): Promise<TaskReminderRunSummary> {
  const findDue = deps.findDueTaskReminders ?? findDueTaskReminders
  const deliver =
    deps.deliverDueTaskReminders ??
    ((reminders: TaskReminder[]) => deliverDueTaskReminders(reminders))
  const reminders = await runBackgroundStep(step, "find-due-task-reminders", () =>
    // The heartbeat: this step runs once per scheduled run.
    monitorCron("process-due-task-reminders", DUE_TASK_REMINDER_CRON, () => findDue())
  )
  const summary: TaskReminderRunSummary = {
    scannedCount: 0,
    sentCount: 0,
    failedCount: 0,
    retryingCount: 0,
    skippedCount: 0,
  }

  for (const reminder of reminders) {
    const outcome = await runBackgroundStep(
      step,
      `deliver-task-reminder-${reminder.id}`,
      () => deliver([reminder])
    )

    for (const key of Object.keys(summary) as Array<keyof TaskReminderRunSummary>) {
      summary[key] += outcome[key]
    }
  }

  return summary
}

/**
 * Scheduled function that drains due task reminders every fifteen minutes.
 *
 * The service claims each reminder before sending, so overlapping passes are
 * already safe; the single concurrency slot simply keeps the scan predictable.
 */
export const processDueRemindersFunction = inngest.createFunction(
  {
    id: "process-due-task-reminders",
    name: "Process due task reminders",
    triggers: [cron(DUE_TASK_REMINDER_CRON)],
    concurrency: 1,
    retries: 2,
  },
  handleDueTaskReminders
)
