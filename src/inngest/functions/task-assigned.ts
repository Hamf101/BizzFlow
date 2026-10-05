import { NonRetriableError } from "inngest"

import { inngest, taskAssignedEvent } from "@/inngest/client"
import {
  runBackgroundStep,
  type BackgroundStepRunner,
} from "@/inngest/functions/shared"
import {
  notifyTaskAssignee,
  type NotifyTaskAssigneeInput,
  type TaskNotificationResult,
} from "@/services/task-service"

/** Run-context slice the assignment handler reads. */
export type TaskAssignedContext = {
  event: { data: unknown }
  step: BackgroundStepRunner
}

/** Injectable service surface, so tests never reach a real database. */
export type TaskAssignedDeps = {
  notifyTaskAssignee?: (
    input: NotifyTaskAssigneeInput
  ) => Promise<TaskNotificationResult>
}

/**
 * Emails the current assignee of a task after an assignment event.
 *
 * The payload is parsed against the published event schema and then used for
 * its identifiers only: the service re-reads the task, so a replayed or delayed
 * event can never notify a stale assignee or leak a stale title.
 *
 * @param context - Run context supplying the event payload and step tooling.
 * @param deps - Optional service override used by tests.
 * @returns Whether the notification was delivered, and why it was skipped.
 * @throws NonRetriableError for a malformed payload or a rejected notification.
 */
export async function handleTaskAssigned(
  { event, step }: TaskAssignedContext,
  deps: TaskAssignedDeps = {}
): Promise<TaskNotificationResult> {
  const payload = taskAssignedEvent.schema.safeParse(event.data)

  if (!payload.success) {
    throw new NonRetriableError(
      "Task assignment event payload is missing required identifiers."
    )
  }

  const notifyAssignee = deps.notifyTaskAssignee ?? notifyTaskAssignee

  return runBackgroundStep(step, "notify-task-assignee", () =>
    notifyAssignee({
      organizationId: payload.data.organizationId,
      taskId: payload.data.taskId,
      assignedToUserId: payload.data.assignedToUserId,
    })
  )
}

/**
 * Event-driven function that notifies a member when a task lands on them.
 *
 * Runs are at-least-once and EmailJS has no idempotency key. Duplicates are
 * stopped by the event id (a repeated publish of one assignment is dropped)
 * and by the delivery ledger: the service skips a channel already recorded as
 * sent for this assignment. A run killed between the provider accepting a send
 * and the ledger write can still repeat that one message.
 */
export const taskAssignedFunction = inngest.createFunction(
  {
    id: "notify-task-assignee",
    name: "Notify a task assignee",
    triggers: [taskAssignedEvent],
    retries: 3,
  },
  handleTaskAssigned
)
