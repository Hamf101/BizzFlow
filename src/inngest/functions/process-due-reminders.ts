import { cron } from "inngest"

import { inngest } from "@/inngest/client"
import {
  runBackgroundStep,
  type BackgroundStepRunner,
} from "@/inngest/functions/shared"
import {
  processDueTaskReminders,
  type TaskReminderRunSummary,
} from "@/services/task-service"

/** Schedule the due-reminder scan runs on, in UTC. */
export const DUE_TASK_REMINDER_CRON = "*/15 * * * *"

/** Run-context slice the due-reminder handler reads. */
export type DueTaskReminderContext = {
  step: BackgroundStepRunner
}

/** Injectable service surface, so tests never reach a real database. */
export type DueTaskReminderDeps = {
  processDueTaskReminders?: () => Promise<TaskReminderRunSummary>
}

/**
 * Delivers one bounded batch of task reminders whose instant has passed.
 *
 * Every decision — batch size, claiming, delivery, and the failure record —
 * belongs to the service. This edge only runs it as a durable step so a
 * completed batch is memoized and never re-sent when a later attempt replays.
 *
 * @param context - Run context supplying durable step tooling.
 * @param deps - Optional service override used by tests.
 * @returns Counters for the scanned, sent, failed, and skipped reminders.
 * @throws NonRetriableError when the scan is rejected, the service error otherwise.
 */
export async function handleDueTaskReminders(
  { step }: DueTaskReminderContext,
  deps: DueTaskReminderDeps = {}
): Promise<TaskReminderRunSummary> {
  const processReminders = deps.processDueTaskReminders ?? processDueTaskReminders

  return runBackgroundStep(step, "process-due-task-reminders", () =>
    processReminders()
  )
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
