import { inngest, taskAssignedEvent } from "@/inngest/client"
import type { TaskAssignedNotification } from "@/services/task-service"

/** Envelope produced for one published assignment notification. */
type TaskAssignedEventPayload = ReturnType<typeof taskAssignedEvent.create>

/** Injectable event-bus surface, so tests never reach the real transport. */
export type TaskAssignedPublisherDeps = {
  send?: (payload: TaskAssignedEventPayload) => Promise<unknown>
}

/**
 * Publishes the `task/assigned` event that emails the new assignee.
 *
 * This is the production edge the task service is handed: the service itself
 * never imports the background-job SDK, so it stays testable and the payload
 * stays identifier-only — the handler re-reads the task before emailing.
 *
 * @param event - Tenant, task, assignee, and actor identifiers.
 * @param deps - Optional event-bus override used by tests.
 * @returns Resolves once the event bus has accepted the event.
 * @throws Error when the event bus rejects the publish.
 */
export async function publishTaskAssigned(
  event: TaskAssignedNotification,
  deps: TaskAssignedPublisherDeps = {}
): Promise<void> {
  const send =
    deps.send ??
    ((payload: TaskAssignedEventPayload): Promise<unknown> =>
      inngest.send(payload))

  await send(taskAssignedEvent.create(event))
}
