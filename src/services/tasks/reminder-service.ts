import type {
  CancelTaskReminderInput,
  ScheduleTaskReminderInput,
  TaskServiceClient,
  TaskServiceDeps,
} from "@/services/tasks/contracts"
import { TaskServiceError } from "@/services/tasks/errors"
import {
  assertTaskIsOpenForChanges,
  createTaskDatabaseError,
  createTaskId,
  getTaskById,
  getTaskClient,
  listTaskReminderRows,
  normalizeTaskTimestamp,
  normalizeTaskUuid,
  recordTaskAuditLog,
  requireInternalTaskMember,
  requireTaskPermission,
  runTaskOperation,
  taskNow,
  TASK_REMINDER_COLUMNS,
} from "@/services/tasks/shared"
import {
  isTerminalTaskStatus,
  parseTaskReminderRow,
  type Task,
  type TaskReminder,
} from "@/types/task"

const RECIPIENT_REJECTION_MESSAGE =
  "Reminder recipient must be an active internal member of this organization."

/**
 * Schedules one future email reminder for a member on an open task.
 *
 * The persisted natural key is `(task, recipient, instant)`, so a replayed
 * scheduling request can never create a second delivery for the same moment.
 *
 * @param input - Actor, tenant, task, recipient, and reminder instant.
 * @param deps - Optional database, identifier, clock, and audit dependencies.
 * @returns Created pending reminder.
 * @throws TaskServiceError when access, validation, state, or the write fails.
 */
export async function scheduleTaskReminder(
  input: ScheduleTaskReminderInput,
  deps: TaskServiceDeps = {}
): Promise<TaskReminder> {
  return runTaskOperation(
    "schedule_task_reminder",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
    },
    async (): Promise<TaskReminder> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:edit",
        "You cannot schedule task reminders."
      )

      const task = await getTaskById(client, input.organizationId, input.taskId)
      assertTaskIsOpenForChanges(task)

      const recipientUserId = normalizeTaskUuid(
        input.recipientUserId,
        "Reminder recipient must be a valid user id."
      )
      await requireInternalTaskMember(
        client,
        input.organizationId,
        recipientUserId,
        RECIPIENT_REJECTION_MESSAGE
      )

      const now = taskNow(deps)
      const remindAt = normalizeTaskTimestamp(
        input.remindAt,
        "Reminder time must be a valid timestamp."
      )

      if (remindAt === null) {
        throw new TaskServiceError("Reminder time is required.", 400)
      }

      if (new Date(remindAt).getTime() <= now.getTime()) {
        throw new TaskServiceError("Reminder time must be in the future.", 400)
      }

      return insertReminderRow(client, deps, now.toISOString(), {
        organizationId: input.organizationId,
        taskId: task.id,
        recipientUserId,
        remindAt,
        channel: input.channel ?? "email",
        origin: "manual",
        actorUserId: input.actorUserId,
      })
    }
  )
}

/**
 * Cancels one pending reminder without removing its delivery history.
 *
 * @param input - Actor, tenant, task, and reminder identifiers.
 * @param deps - Optional database, clock, and audit dependencies.
 * @returns Cancelled reminder.
 * @throws TaskServiceError when access, state, or the write fails.
 */
export async function cancelTaskReminder(
  input: CancelTaskReminderInput,
  deps: TaskServiceDeps = {}
): Promise<TaskReminder> {
  return runTaskOperation(
    "cancel_task_reminder",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
      reminderId: input.reminderId,
    },
    async (): Promise<TaskReminder> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:edit",
        "You cannot cancel task reminders."
      )

      const reminder = await getTaskReminderById(client, input)

      if (reminder.status !== "pending") {
        throw new TaskServiceError(
          "Only pending task reminders can be cancelled.",
          409
        )
      }

      const { data, error } = await client
        .from("task_reminders")
        .update({
          status: "cancelled",
          updated_at: taskNow(deps).toISOString(),
        })
        .eq("id", reminder.id)
        .eq("org_id", input.organizationId)
        .eq("status", "pending")
        .select(TASK_REMINDER_COLUMNS)
        .maybeSingle()

      if (error) {
        throw createTaskDatabaseError(error, "Unable to cancel task reminder.")
      }

      if (!data) {
        throw new TaskServiceError(
          "Task reminder changed since it was opened. Reload and try again.",
          409
        )
      }

      const cancelledReminder = parseTaskReminderRow(data)
      await recordTaskAuditLog(deps, {
        organizationId: cancelledReminder.organizationId,
        actorUserId: input.actorUserId,
        action: "task_reminder.cancelled",
        targetType: "task_reminder",
        targetId: cancelledReminder.id,
        metadata: {
          taskId: cancelledReminder.taskId,
          remindAt: cancelledReminder.remindAt,
        },
      })

      return cancelledReminder
    }
  )
}

/**
 * Brings a task's automatic due reminder in line with its current state.
 *
 * A task earns exactly one automatic reminder, at its due instant, for whoever
 * currently holds it. Anything that changes that answer — a new due date, a
 * reassignment, closing the task — re-runs this, so a member never keeps a
 * reminder for work that moved to someone else or no longer exists.
 *
 * Deliberate boundaries:
 * - Only `origin = 'automatic'` rows are touched. A reminder a member scheduled
 *   by hand is theirs, and stays exactly as they left it.
 * - A row already present for the same (task, recipient, instant) is left alone
 *   whatever its origin or status. That keeps the sync idempotent, means
 *   cancelling an automatic reminder sticks instead of being resurrected by the
 *   next edit, and avoids colliding with the unique key that spans both origins.
 * - A due date already in the past schedules nothing; there is no moment left
 *   to remind anyone about.
 *
 * Failures here are logged and swallowed: the task mutation is already
 * committed and audited, and losing a convenience reminder must not present a
 * saved task as failed.
 *
 * @param client - Trusted tenant-scoped database client.
 * @param deps - Identifier, clock, and audit dependencies.
 * @param task - Task in its state after the mutation that triggered the sync.
 * @param actorUserId - Member recorded as having caused the schedule.
 */
export async function syncAutomaticTaskReminder(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  task: Task,
  actorUserId: string
): Promise<void> {
  try {
    const now = taskNow(deps)
    const desired = resolveDesiredAutomaticReminder(task, now)
    const existing = await listTaskReminderRows(
      client,
      task.organizationId,
      task.id
    )

    // A closed task's reminder is genuinely cancelled — terminal statuses are
    // not reopenable, so nothing can ever revive it and the member should still
    // see it in the task's history. Every other reason the sync retires a row
    // (the due date moved, the assignee changed, either was cleared) is
    // reversible, so those rows are superseded and stay revivable.
    const retiredStatus = isTerminalTaskStatus(task.status)
      ? "cancelled"
      : "superseded"

    for (const reminder of existing) {
      if (
        reminder.origin === "automatic" &&
        reminder.status === "pending" &&
        (desired === null ||
          reminder.recipientUserId !== desired.recipientUserId ||
          reminder.remindAt !== desired.remindAt)
      ) {
        await retireAutomaticReminderRow(client, deps, reminder, retiredStatus)
      }
    }

    if (desired === null) {
      return
    }

    // `(task, recipient, instant)` is a unique key and it spans every origin
    // and status, so an existing row for this instant cannot be inserted over —
    // it has to be reused or left alone.
    const match = existing.find(
      (reminder: TaskReminder): boolean =>
        reminder.recipientUserId === desired.recipientUserId &&
        reminder.remindAt === desired.remindAt
    )

    if (match) {
      // `superseded` is a row this sync displaced earlier, so bringing the same
      // instant back must bring the reminder back with it — that is the whole
      // point of reassigning to the original member or restoring a due date.
      //
      // Every other status is left exactly as it is: `pending` is already
      // correct, `cancelled` records a member choosing to stop this reminder,
      // and `sent` / `failed` already had their attempt.
      if (match.origin === "automatic" && match.status === "superseded") {
        await reviveAutomaticReminderRow(client, deps, match, task, actorUserId)
      }

      return
    }

    await insertAutomaticReminderRow(client, deps, task, desired, actorUserId)
  } catch (error: unknown) {
    console.warn("task_automatic_reminder_sync_failed", {
      organizationId: task.organizationId,
      taskId: task.id,
      reason: error instanceof Error ? error.message : "Unknown sync error",
    })
  }
}

/**
 * Decides which automatic reminder a task should currently have, if any.
 */
function resolveDesiredAutomaticReminder(
  task: Task,
  now: Date
): { recipientUserId: string; remindAt: string } | null {
  if (isTerminalTaskStatus(task.status)) {
    return null
  }

  if (task.dueAt === null || task.assignedTo === null) {
    return null
  }

  if (new Date(task.dueAt).getTime() <= now.getTime()) {
    return null
  }

  return { recipientUserId: task.assignedTo, remindAt: task.dueAt }
}

/**
 * Retires an automatic reminder the task no longer calls for.
 *
 * The row stays on the `(task, recipient, instant)` unique key either way, so
 * the status is what tells a later sync whether it may bring the reminder back.
 *
 * @param status - `superseded` when the change is reversible, `cancelled` when
 *   the task closed and nothing can revive it.
 */
async function retireAutomaticReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  reminder: TaskReminder,
  status: "superseded" | "cancelled"
): Promise<void> {
  const { error } = await client
    .from("task_reminders")
    .update({
      status,
      updated_at: taskNow(deps).toISOString(),
    })
    .eq("id", reminder.id)
    .eq("org_id", reminder.organizationId)
    .eq("status", "pending")

  if (error) {
    throw createTaskDatabaseError(error, "Unable to retire task reminder.")
  }
}

/**
 * Returns a superseded automatic reminder to pending, in place.
 *
 * An update rather than an insert because the row still holds
 * `(task, recipient, instant)` on the unique key. The attempt counter and last
 * error are reset so the revived reminder starts its delivery budget fresh.
 */
async function reviveAutomaticReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  reminder: TaskReminder,
  task: Task,
  actorUserId: string
): Promise<void> {
  const { data, error } = await client
    .from("task_reminders")
    .update({
      status: "pending",
      attempt_count: 0,
      last_error: null,
      sent_at: null,
      updated_at: taskNow(deps).toISOString(),
    })
    .eq("id", reminder.id)
    .eq("org_id", reminder.organizationId)
    // Never revive a member's cancellation or an already-delivered row.
    .eq("status", "superseded")
    .eq("origin", "automatic")
    .select(TASK_REMINDER_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to restore task reminder.")
  }

  if (!data) {
    return
  }

  await recordReminderScheduled(deps, parseTaskReminderRow(data), actorUserId)
}

async function insertAutomaticReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  task: Task,
  desired: { recipientUserId: string; remindAt: string },
  actorUserId: string
): Promise<void> {
  await insertReminderRow(client, deps, taskNow(deps).toISOString(), {
    organizationId: task.organizationId,
    taskId: task.id,
    recipientUserId: desired.recipientUserId,
    remindAt: desired.remindAt,
    channel: "email",
    origin: "automatic",
    actorUserId,
  })
}

/** Inserts one pending reminder and audits it as scheduled. */
async function insertReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  nowIso: string,
  row: {
    organizationId: string
    taskId: string
    recipientUserId: string
    remindAt: string
    channel: TaskReminder["channel"]
    origin: TaskReminder["origin"]
    actorUserId: string
  }
): Promise<TaskReminder> {
  const { data, error } = await client
    .from("task_reminders")
    .insert({
      id: createTaskId(deps),
      org_id: row.organizationId,
      task_id: row.taskId,
      recipient_user_id: row.recipientUserId,
      remind_at: row.remindAt,
      channel: row.channel,
      origin: row.origin,
      status: "pending",
      attempt_count: 0,
      last_error: null,
      sent_at: null,
      created_by: row.actorUserId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(TASK_REMINDER_COLUMNS)
    .maybeSingle()

  if (error || !data) {
    throw createReminderInsertError(error)
  }

  const reminder = parseTaskReminderRow(data)
  await recordReminderScheduled(deps, reminder, row.actorUserId)

  return reminder
}

// An automatic reminder's audit names its origin; a member's own does not.
async function recordReminderScheduled(
  deps: TaskServiceDeps,
  reminder: TaskReminder,
  actorUserId: string
): Promise<void> {
  await recordTaskAuditLog(deps, {
    organizationId: reminder.organizationId,
    actorUserId,
    action: "task_reminder.scheduled",
    targetType: "task_reminder",
    targetId: reminder.id,
    metadata: {
      taskId: reminder.taskId,
      recipientUserId: reminder.recipientUserId,
      remindAt: reminder.remindAt,
      ...(reminder.origin === "automatic" ? { origin: reminder.origin } : {}),
    },
  })
}

async function getTaskReminderById(
  client: TaskServiceClient,
  input: CancelTaskReminderInput
): Promise<TaskReminder> {
  const { data, error } = await client
    .from("task_reminders")
    .select(TASK_REMINDER_COLUMNS)
    .eq("id", input.reminderId)
    .eq("org_id", input.organizationId)
    .eq("task_id", input.taskId)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load task reminder.")
  }

  if (!data) {
    throw new TaskServiceError("Task reminder was not found.", 404)
  }

  return parseTaskReminderRow(data)
}

function createReminderInsertError(error: unknown): TaskServiceError {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : undefined

  return code === "23505"
    ? new TaskServiceError(
        "A reminder is already scheduled for this recipient at that time.",
        409
      )
    : createTaskDatabaseError(error, "Unable to schedule task reminder.")
}
