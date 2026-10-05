import type {
  CancelTaskReminderInput,
  NotifyTaskAssigneeInput,
  ScheduleTaskReminderInput,
  TaskNotificationResult,
  TaskReminderRunSummary,
  TaskServiceClient,
  TaskServiceDeps,
} from "@/services/tasks/contracts"
import { TaskServiceError } from "@/services/tasks/errors"
import {
  assertTaskIsOpenForChanges,
  canReceiveTaskWork,
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
  TASK_COLUMNS,
  TASK_REMINDER_COLUMNS,
} from "@/services/tasks/shared"
import {
  loadOrganizationNotificationSettingsMap,
  recordNotificationDelivery as defaultRecordNotificationDelivery,
} from "@/services/notification-service"
import { sendSms as defaultSendSms } from "@/services/sms-service"
import {
  sendTaskEmail as defaultSendTaskEmail,
  type SendTaskEmailInput,
} from "@/services/tasks/task-email"
import {
  isNotificationChannelEnabled,
  type NotificationChannel,
  type NotificationDeliveryStatus,
  type NotificationPurpose,
} from "@/types/notification"
import {
  isTerminalTaskStatus,
  parseTaskReminderRow,
  parseTaskRow,
  type Task,
  type TaskReminder,
} from "@/types/task"

/** Largest number of due reminders one scheduled pass will claim. */
export const TASK_REMINDER_BATCH_LIMIT = 100

/** Delivery attempts one reminder is given before it is abandoned. */
export const TASK_REMINDER_MAX_ATTEMPTS = 3

/** Seconds a claimed reminder is locked from concurrent passes before timing out. */
export const TASK_REMINDER_LEASE_SECONDS = 300

const RECIPIENT_REJECTION_MESSAGE =
  "Reminder recipient must be an active internal member of this organization."

type TaskReminderRecipient = {
  email: string
  fullName: string | null
  phoneNumber: string | null
  /** True only when BOTH the organization and the member allow the channel. */
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

type ProfileContactRow = {
  id: string
  email: string | null
  full_name: string | null
  phone_number: string | null
}

type MembershipScopeRow = {
  org_id: string
  user_id: string
  role: string
  role_definition?: { permissions: string[] | null } | null
  email_notifications_enabled: boolean
  sms_notifications_enabled: boolean
}

type DueReminderContext = {
  tasks: Map<string, Task>
  recipients: Map<string, TaskReminderRecipient>
}

type ReminderPassOutcome = "sent" | "failed" | "retrying" | "skipped"

// One counter per outcome, so a new outcome cannot be silently uncounted.
const REMINDER_OUTCOME_COUNTERS = {
  sent: "sentCount",
  failed: "failedCount",
  retrying: "retryingCount",
  skipped: "skippedCount",
} as const satisfies Record<ReminderPassOutcome, keyof TaskReminderRunSummary>

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

      const nowIso = now.toISOString()
      const { data, error } = await client
        .from("task_reminders")
        .insert({
          id: createTaskId(deps),
          org_id: input.organizationId,
          task_id: task.id,
          recipient_user_id: recipientUserId,
          remind_at: remindAt,
          channel: input.channel ?? "email",
          origin: "manual",
          status: "pending",
          attempt_count: 0,
          last_error: null,
          sent_at: null,
          created_by: input.actorUserId,
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select(TASK_REMINDER_COLUMNS)
        .maybeSingle()

      if (error || !data) {
        throw createReminderInsertError(error)
      }

      const reminder = parseTaskReminderRow(data)
      await recordTaskAuditLog(deps, {
        organizationId: reminder.organizationId,
        actorUserId: input.actorUserId,
        action: "task_reminder.scheduled",
        targetType: "task_reminder",
        targetId: reminder.id,
        metadata: {
          taskId: reminder.taskId,
          recipientUserId: reminder.recipientUserId,
          remindAt: reminder.remindAt,
        },
      })

      return reminder
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

  const revived = parseTaskReminderRow(data)
  await recordTaskAuditLog(deps, {
    organizationId: revived.organizationId,
    actorUserId,
    action: "task_reminder.scheduled",
    targetType: "task_reminder",
    targetId: revived.id,
    metadata: {
      taskId: task.id,
      recipientUserId: revived.recipientUserId,
      remindAt: revived.remindAt,
      origin: revived.origin,
    },
  })
}

async function insertAutomaticReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  task: Task,
  desired: { recipientUserId: string; remindAt: string },
  actorUserId: string
): Promise<void> {
  const nowIso = taskNow(deps).toISOString()
  const { data, error } = await client
    .from("task_reminders")
    .insert({
      id: createTaskId(deps),
      org_id: task.organizationId,
      task_id: task.id,
      recipient_user_id: desired.recipientUserId,
      remind_at: desired.remindAt,
      channel: "email",
      origin: "automatic",
      status: "pending",
      attempt_count: 0,
      last_error: null,
      sent_at: null,
      created_by: actorUserId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(TASK_REMINDER_COLUMNS)
    .maybeSingle()

  if (error || !data) {
    throw createReminderInsertError(error)
  }

  const reminder = parseTaskReminderRow(data)
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
      origin: reminder.origin,
    },
  })
}

/**
 * Delivers one bounded batch of reminders whose scheduled instant has passed.
 *
 * This is a trusted background pass with no actor, so it performs no permission
 * check. Each row is claimed with a guarded attempt-count increment before the
 * email is sent, so two concurrent runs can never both claim the same reminder,
 * and a reminder already `sent` is never rescanned. A reminder the provider
 * refused for a transient reason stays `pending` and is retried by a later
 * pass until its attempt budget runs out.
 *
 * @param deps - Optional database, clock, and email dependencies.
 * @returns Counters for the scanned, sent, failed, retrying, and skipped rows.
 * @throws TaskServiceError when the due-reminder scan itself fails.
 */
export async function processDueTaskReminders(
  deps: TaskServiceDeps = {}
): Promise<TaskReminderRunSummary> {
  return deliverDueTaskReminders(await findDueTaskReminders(deps), deps)
}

/**
 * Lists one bounded batch of reminders that are due and not leased by a pass.
 *
 * @param deps - Optional database and clock dependencies.
 * @returns Due pending reminders, oldest first.
 * @throws TaskServiceError when the scan fails.
 */
export async function findDueTaskReminders(
  deps: TaskServiceDeps = {}
): Promise<TaskReminder[]> {
  return runTaskOperation(
    "find_due_task_reminders",
    { batchLimit: TASK_REMINDER_BATCH_LIMIT },
    async (): Promise<TaskReminder[]> => {
      const now = taskNow(deps)
      const leaseCutoffIso = new Date(
        now.getTime() - TASK_REMINDER_LEASE_SECONDS * 1000
      ).toISOString()

      return listDueTaskReminders(
        getTaskClient(deps),
        now.toISOString(),
        leaseCutoffIso
      )
    }
  )
}

/**
 * Claims and delivers reminders returned by `findDueTaskReminders`.
 *
 * A background job calls this once per reminder, so a killed or retried run
 * repeats at most one send — and the delivery ledger stops even that one.
 *
 * @param reminders - Due reminders as they were listed.
 * @param deps - Optional database, clock, email, and SMS dependencies.
 * @returns Counters for the scanned, sent, failed, retrying, and skipped rows.
 * @throws TaskServiceError when the recipients cannot be loaded.
 */
export async function deliverDueTaskReminders(
  reminders: readonly TaskReminder[],
  deps: TaskServiceDeps = {}
): Promise<TaskReminderRunSummary> {
  return runTaskOperation(
    "deliver_due_task_reminders",
    { reminderCount: reminders.length },
    async (): Promise<TaskReminderRunSummary> => {
      const summary: TaskReminderRunSummary = {
        scannedCount: reminders.length,
        sentCount: 0,
        failedCount: 0,
        retryingCount: 0,
        skippedCount: 0,
      }

      if (reminders.length === 0) {
        return summary
      }

      const client = getTaskClient(deps)
      const nowIso = taskNow(deps).toISOString()
      const context = await loadDueReminderContext(client, reminders)

      for (const dueReminder of reminders) {
        const outcome = await processOneDueReminder(
          client,
          dueReminder,
          context,
          nowIso,
          deps
        )

        summary[REMINDER_OUTCOME_COUNTERS[outcome]] += 1
      }

      return summary
    }
  )
}

/**
 * Emails the current assignee of a task after an assignment event.
 *
 * The task is re-read from the tenant, so a replayed or delayed event can never
 * notify someone who is no longer the assignee. A channel already recorded as
 * sent for this assignment is not sent again, so a retried run is safe.
 *
 * @param input - Tenant, task, and the assignee named by the event.
 * @param deps - Optional database and email dependencies.
 * @returns Whether the notification was delivered, and why it was skipped.
 * @throws TaskServiceError when the task cannot be read or delivery fails.
 */
export async function notifyTaskAssignee(
  input: NotifyTaskAssigneeInput,
  deps: TaskServiceDeps = {}
): Promise<TaskNotificationResult> {
  return runTaskOperation(
    "notify_task_assignee",
    {
      organizationId: input.organizationId,
      taskId: input.taskId,
    },
    async (): Promise<TaskNotificationResult> => {
      const client = getTaskClient(deps)
      const task = await getTaskById(client, input.organizationId, input.taskId)

      if (task.assignedTo === null || task.assignedTo !== input.assignedToUserId) {
        return { delivered: false, skippedReason: "assignment_changed" }
      }

      if (isTerminalTaskStatus(task.status)) {
        return { delivered: false, skippedReason: "task_closed" }
      }

      const recipient = await loadTaskRecipient(
        client,
        task.organizationId,
        task.assignedTo
      )

      if (!recipient) {
        return { delivered: false, skippedReason: "recipient_unavailable" }
      }

      const recipientUserId = task.assignedTo
      const log = createDeliveryLog(deps, {
        organizationId: task.organizationId,
        recipientUserId,
        purpose: "task_assigned",
      })
      const emailReference = taskAssignmentReference(task)

      if (!recipient.emailNotificationsEnabled) {
        await log("email", emailReference, "suppressed")
      } else if (
        !(await hasSentDelivery(client, task.organizationId, "email", emailReference))
      ) {
        try {
          await (deps.sendTaskEmail ?? defaultSendTaskEmail)(
            createTaskEmailRequest("assigned", emailReference, task, recipient)
          )
        } catch (error: unknown) {
          await log("email", emailReference, "failed", toSafeReminderFailureReason(error))
          // Rethrown so the Inngest handler retries the assignment
          // notification instead of reporting a delivery that never happened.
          throw error
        }
        await log("email", emailReference, "sent")
      }

      if (!recipient.phoneNumber) {
        return { delivered: true, skippedReason: null }
      }

      const smsReference = `task-assigned-sms/${task.id}/${recipientUserId}/${task.assignedAt}`

      if (!recipient.smsNotificationsEnabled) {
        await log("sms", smsReference, "suppressed")
      } else if (
        !(await hasSentDelivery(client, task.organizationId, "sms", smsReference))
      ) {
        try {
          await sendSmsOrThrow(deps, {
            recipientPhone: recipient.phoneNumber,
            message: `Task Assigned: "${task.title}" has been assigned to you.`,
            reference: smsReference,
          })
        } catch (error: unknown) {
          await log("sms", smsReference, "failed", toSafeReminderFailureReason(error))
          console.warn("task_assignment_sms_failed", {
            taskId: task.id,
            organizationId: task.organizationId,
          })

          // Email is the primary channel. Failing the whole job when only SMS
          // broke would retry for nothing once email is out, so the SMS failure
          // is recorded rather than thrown — unless email is switched off, in
          // which case nothing reached them.
          if (!recipient.emailNotificationsEnabled) {
            throw new TaskServiceError(
              "Task assignment notification could not be delivered.",
              502
            )
          }
          return { delivered: true, skippedReason: null }
        }
        await log("sms", smsReference, "sent")
      }

      return { delivered: true, skippedReason: null }
    }
  )
}

/**
 * The delivery reference — and background event id — of one assignment.
 *
 * @param task - Task with its current assignee and assignment instant.
 * @returns A reference unique to this assignee and assignment instant.
 */
export function taskAssignmentReference(task: {
  id: string
  assignedTo: string | null
  assignedAt: string | null
}): string {
  return `task-assigned/${task.id}/${task.assignedTo}/${task.assignedAt}`
}

type DeliveryLog = (
  channel: NotificationChannel,
  reference: string,
  status: NotificationDeliveryStatus,
  lastError?: string | null
) => Promise<unknown>

/** One recorder per notification, so every outcome lands on the ledger the same way. */
function createDeliveryLog(
  deps: TaskServiceDeps,
  base: {
    organizationId: string
    recipientUserId: string
    purpose: NotificationPurpose
    attemptCount?: number
  }
): DeliveryLog {
  const record = deps.recordNotificationDelivery ?? defaultRecordNotificationDelivery

  return (channel, reference, status, lastError = null) =>
    record({ ...base, channel, reference, status, lastError })
}

/**
 * Whether this exact delivery already went out.
 *
 * The ledger row is written before the reminder is marked sent, so a send whose
 * outcome write was lost — or a retried background run — is not repeated. A
 * failed read throws: not sending is safer than sending twice.
 */
async function hasSentDelivery(
  client: TaskServiceClient,
  organizationId: string,
  channel: NotificationChannel,
  reference: string
): Promise<boolean> {
  const { data, error } = await client
    .from("notification_deliveries")
    .select("id")
    .eq("org_id", organizationId)
    .eq("channel", channel)
    .eq("reference", reference)
    .eq("status", "sent")
    .limit(1)

  if (error || !data) {
    throw createTaskDatabaseError(error, "Unable to check earlier notification deliveries.")
  }

  return data.length > 0
}

/** Providers report refusal by returning `success: false`; this makes it a throw. */
async function sendSmsOrThrow(
  deps: TaskServiceDeps,
  input: { recipientPhone: string; message: string; reference: string }
): Promise<void> {
  const result = await (deps.sendSms ?? defaultSendSms)(input)

  if (!result.success) {
    throw new TaskServiceError(result.error ?? "SMS delivery failed.", 502)
  }
}

async function processOneDueReminder(
  client: TaskServiceClient,
  dueReminder: TaskReminder,
  context: DueReminderContext,
  nowIso: string,
  deps: TaskServiceDeps
): Promise<ReminderPassOutcome> {
  try {
    const claimedReminder = await claimTaskReminder(client, dueReminder, nowIso)

    if (!claimedReminder) {
      return "skipped"
    }

    return await deliverClaimedReminder(
      client,
      claimedReminder,
      context,
      nowIso,
      deps
    )
  } catch (error: unknown) {
    console.error("task_reminder_processing_failed", {
      reminderId: dueReminder.id,
      organizationId: dueReminder.organizationId,
      reason: error instanceof Error ? error.name : "Unknown reminder error",
    })
    return "skipped"
  }
}

async function deliverClaimedReminder(
  client: TaskServiceClient,
  reminder: TaskReminder,
  context: DueReminderContext,
  nowIso: string,
  deps: TaskServiceDeps
): Promise<ReminderPassOutcome> {
  const task = context.tasks.get(reminder.taskId)
  const recipient = context.recipients.get(
    createRecipientKey(reminder.organizationId, reminder.recipientUserId)
  )
  const blockedReason = resolveReminderBlock(reminder, task, recipient)

  if (blockedReason !== null || !task || !recipient) {
    await markReminderOutcome(client, reminder, nowIso, {
      status: "failed",
      last_error: blockedReason ?? "Task reminder could not be prepared.",
    })
    return "failed"
  }

  const channel = reminder.channel
  const reference = `task-reminder/${reminder.id}`
  const log = createDeliveryLog(deps, {
    organizationId: reminder.organizationId,
    recipientUserId: reminder.recipientUserId,
    purpose: "task_reminder",
    attemptCount: reminder.attemptCount,
  })
  const enabled =
    channel === "sms"
      ? recipient.smsNotificationsEnabled
      : recipient.emailNotificationsEnabled

  if (!enabled) {
    // Cancelled, not sent: nothing was handed to a provider, and recording
    // it as sent would make the reminder history claim a delivery that
    // never happened. Cancelling also stops it being rescanned forever.
    await markReminderOutcome(client, reminder, nowIso, {
      status: "cancelled",
      last_error: null,
    })
    await log(channel, reference, "suppressed")
    return "skipped"
  }

  if (channel === "sms" && !recipient.phoneNumber) {
    const reason = "Reminder recipient has no phone number for SMS."
    await markReminderOutcome(client, reminder, nowIso, {
      status: "failed",
      last_error: reason,
    })
    await log(channel, reference, "failed", reason)
    return "failed"
  }

  if (!(await hasSentDelivery(client, reminder.organizationId, channel, reference))) {
    try {
      if (channel === "sms") {
        await sendSmsOrThrow(deps, {
          recipientPhone: recipient.phoneNumber ?? "",
          message: `Task Reminder: "${task.title}" is due. Check your task dashboard for details.`,
          reference,
        })
      } else {
        await (deps.sendTaskEmail ?? defaultSendTaskEmail)(
          createTaskEmailRequest("reminder", reference, task, recipient)
        )
      }
    } catch (error: unknown) {
      const retrying = shouldRetryReminderDelivery(reminder, error)
      const reason = toSafeReminderFailureReason(error)
      await markReminderOutcome(client, reminder, nowIso, {
        status: retrying ? "pending" : "failed",
        last_error: reason,
      })
      await log(channel, reference, "failed", reason)
      return retrying ? "retrying" : "failed"
    }

    // The ledger row goes first: if marking the reminder sent is lost, the
    // next pass finds this row and does not send again.
    await log(channel, reference, "sent")
  }

  await markReminderOutcome(client, reminder, nowIso, {
    status: "sent",
    sent_at: nowIso,
    last_error: null,
  })
  return "sent"
}

/**
 * Decides whether a refused delivery deserves another scheduled pass.
 *
 * An email provider blip is transient, so the reminder is left `pending` with
 * the reason recorded and the next scan picks it up; a request the provider
 * rejected outright, or an exhausted attempt budget, is terminal.
 */
function shouldRetryReminderDelivery(
  reminder: TaskReminder,
  error: unknown
): boolean {
  if (reminder.attemptCount >= TASK_REMINDER_MAX_ATTEMPTS) {
    return false
  }

  return !(error instanceof TaskServiceError) || error.statusCode >= 500
}

function resolveReminderBlock(
  reminder: TaskReminder,
  task: Task | undefined,
  recipient: TaskReminderRecipient | undefined
): string | null {
  if (!task || task.organizationId !== reminder.organizationId) {
    return "The linked task is no longer available."
  }

  if (isTerminalTaskStatus(task.status)) {
    return "The task was already closed before the reminder was due."
  }

  if (!recipient) {
    return "The reminder recipient is no longer an active member with task access."
  }

  return null
}

async function listDueTaskReminders(
  client: TaskServiceClient,
  nowIso: string,
  leaseCutoffIso: string
): Promise<TaskReminder[]> {
  const { data, error } = await client
    .from("task_reminders")
    .select(TASK_REMINDER_COLUMNS)
    .eq("status", "pending")
    .lte("remind_at", nowIso)
    .or(`attempt_count.eq.0,updated_at.lte.${leaseCutoffIso}`)
    .order("remind_at", { ascending: true })
    .limit(TASK_REMINDER_BATCH_LIMIT)

  if (error || !data) {
    throw createTaskDatabaseError(error, "Unable to load due task reminders.")
  }

  return data.map(parseTaskReminderRow)
}

async function claimTaskReminder(
  client: TaskServiceClient,
  reminder: TaskReminder,
  nowIso: string
): Promise<TaskReminder | null> {
  const { data, error } = await client
    .from("task_reminders")
    .update({
      attempt_count: reminder.attemptCount + 1,
      updated_at: nowIso,
    })
    .eq("id", reminder.id)
    .eq("org_id", reminder.organizationId)
    .eq("status", "pending")
    .eq("attempt_count", reminder.attemptCount)
    .select(TASK_REMINDER_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to claim a task reminder.")
  }

  return data ? parseTaskReminderRow(data) : null
}

async function markReminderOutcome(
  client: TaskServiceClient,
  reminder: TaskReminder,
  nowIso: string,
  values: {
    status: "pending" | "sent" | "failed" | "cancelled"
    sent_at?: string
    last_error: string | null
  }
): Promise<void> {
  const { data, error } = await client
    .from("task_reminders")
    .update({ ...values, updated_at: nowIso })
    .eq("id", reminder.id)
    .eq("org_id", reminder.organizationId)
    .eq("status", "pending")
    .eq("attempt_count", reminder.attemptCount)
    .select("id")
    .maybeSingle()

  if (error || !data) {
    console.warn("task_reminder_outcome_not_applied", {
      reminderId: reminder.id,
      organizationId: reminder.organizationId,
      status: values.status,
    })
  }
}

async function loadDueReminderContext(
  client: TaskServiceClient,
  reminders: readonly TaskReminder[]
): Promise<DueReminderContext> {
  const taskIds = Array.from(
    new Set(reminders.map((reminder: TaskReminder): string => reminder.taskId))
  )
  const recipientIds = Array.from(
    new Set(
      reminders.map((reminder: TaskReminder): string => reminder.recipientUserId)
    )
  )
  const organizationIds = Array.from(
    new Set(
      reminders.map((reminder: TaskReminder): string => reminder.organizationId)
    )
  )
  const [taskResult, profileResult, membershipResult, organizationSettings] =
    await Promise.all([
      client.from("tasks").select(TASK_COLUMNS).in("id", taskIds),
      client
        .from("profiles")
        .select("id,email,full_name,phone_number")
        .in("id", recipientIds),
      client
        .from("organization_memberships")
        .select(
          "org_id,user_id,role,email_notifications_enabled,sms_notifications_enabled,role_definition:organization_roles!organization_memberships_role_definition_fk(permissions)"
        )
        .eq("status", "active")
        .in("user_id", recipientIds),
      loadOrganizationNotificationSettingsMap(client, organizationIds),
    ])

  if (taskResult.error || !taskResult.data) {
    throw createTaskDatabaseError(
      taskResult.error,
      "Unable to load tasks for due reminders."
    )
  }

  if (profileResult.error || !profileResult.data) {
    throw createTaskDatabaseError(
      profileResult.error,
      "Unable to load reminder recipients."
    )
  }

  if (membershipResult.error || !membershipResult.data) {
    throw createTaskDatabaseError(
      membershipResult.error,
      "Unable to load reminder recipient memberships."
    )
  }

  const contacts = new Map<string, ProfileContactRow>(
    (profileResult.data as ProfileContactRow[]).map(
      (row: ProfileContactRow): [string, ProfileContactRow] => [row.id, row]
    )
  )
  const recipients = new Map<string, TaskReminderRecipient>()

  ;(membershipResult.data as MembershipScopeRow[]).forEach(
    (membership: MembershipScopeRow): void => {
      const contact = contacts.get(membership.user_id)

      if (!canReceiveTaskWork(membership) || !contact?.email) {
        return
      }

      // The organization switch gates the member preference: a channel the
      // organization turned off cannot be re-enabled by an individual.
      const orgSettings = organizationSettings.get(membership.org_id) ?? {
        emailNotificationsEnabled: true,
        smsNotificationsEnabled: true,
      }

      recipients.set(createRecipientKey(membership.org_id, membership.user_id), {
        email: contact.email,
        fullName: contact.full_name,
        phoneNumber: contact.phone_number,
        emailNotificationsEnabled: isNotificationChannelEnabled({
          organizationEnabled: orgSettings.emailNotificationsEnabled,
          memberEnabled: membership.email_notifications_enabled,
        }),
        smsNotificationsEnabled: isNotificationChannelEnabled({
          organizationEnabled: orgSettings.smsNotificationsEnabled,
          memberEnabled: membership.sms_notifications_enabled,
        }),
      })
    }
  )

  return {
    tasks: new Map<string, Task>(
      taskResult.data.map((row: unknown): [string, Task] => {
        const task = parseTaskRow(row)
        return [task.id, task]
      })
    ),
    recipients,
  }
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

async function loadTaskRecipient(
  client: TaskServiceClient,
  organizationId: string,
  userId: string
): Promise<TaskReminderRecipient | null> {
  const { data: membershipData, error: membershipError } = await client
    .from("organization_memberships")
    .select(
      "role,email_notifications_enabled,sms_notifications_enabled,role_definition:organization_roles!organization_memberships_role_definition_fk(permissions)"
    )
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (membershipError) {
    throw createTaskDatabaseError(membershipError, "Unable to load task permissions.")
  }

  if (!membershipData || !canReceiveTaskWork(membershipData)) {
    return null
  }

  const organizationSettings = await loadOrganizationNotificationSettingsMap(
    client,
    [organizationId]
  )
  const orgSettings = organizationSettings.get(organizationId) ?? {
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: true,
  }

  const { data, error } = await client
    .from("profiles")
    .select("id,email,full_name,phone_number")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load the task recipient.")
  }

  const contact = data as ProfileContactRow | null

  return contact?.email
    ? {
        email: contact.email,
        fullName: contact.full_name,
        phoneNumber: contact.phone_number,
        emailNotificationsEnabled: isNotificationChannelEnabled({
          organizationEnabled: orgSettings.emailNotificationsEnabled,
          memberEnabled: membershipData.email_notifications_enabled,
        }),
        smsNotificationsEnabled: isNotificationChannelEnabled({
          organizationEnabled: orgSettings.smsNotificationsEnabled,
          memberEnabled: membershipData.sms_notifications_enabled,
        }),
      }
    : null
}

function createTaskEmailRequest(
  kind: SendTaskEmailInput["kind"],
  deliveryReference: string,
  task: Task,
  recipient: TaskReminderRecipient
): SendTaskEmailInput {
  return {
    kind,
    deliveryReference,
    taskId: task.id,
    taskTitle: task.title,
    dueAt: task.dueAt,
    recipientEmail: recipient.email,
    recipientName: recipient.fullName,
  }
}

function createRecipientKey(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`
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

function toSafeReminderFailureReason(error: unknown): string {
  const message =
    error instanceof TaskServiceError
      ? error.message
      : "Task reminder delivery failed."

  return message.slice(0, 500)
}
