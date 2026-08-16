import type {
  CancelTaskReminderInput,
  ListTaskRemindersInput,
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
import { isNotificationChannelEnabled } from "@/types/notification"
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
const INTERNAL_RECIPIENT_ROLES = ["owner_admin", "manager", "staff"]

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

    for (const reminder of existing) {
      if (
        reminder.origin === "automatic" &&
        reminder.status === "pending" &&
        (desired === null ||
          reminder.recipientUserId !== desired.recipientUserId ||
          reminder.remindAt !== desired.remindAt)
      ) {
        await cancelAutomaticReminderRow(client, deps, reminder)
      }
    }

    if (desired === null) {
      return
    }

    // `(task, recipient, instant)` is a unique key, and it spans both origins.
    // Matching against every reminder — not just the automatic ones — keeps the
    // sync idempotent and avoids colliding with a manual reminder a member
    // already scheduled for that exact moment.
    const alreadyScheduled = existing.some(
      (reminder: TaskReminder): boolean =>
        reminder.recipientUserId === desired.recipientUserId &&
        reminder.remindAt === desired.remindAt
    )

    if (alreadyScheduled) {
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

async function cancelAutomaticReminderRow(
  client: TaskServiceClient,
  deps: TaskServiceDeps,
  reminder: TaskReminder
): Promise<void> {
  const { error } = await client
    .from("task_reminders")
    .update({
      status: "cancelled",
      updated_at: taskNow(deps).toISOString(),
    })
    .eq("id", reminder.id)
    .eq("org_id", reminder.organizationId)
    .eq("status", "pending")

  if (error) {
    throw createTaskDatabaseError(error, "Unable to cancel task reminder.")
  }
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
 * Lists every reminder scheduled against one visible task.
 *
 * @param input - Actor, tenant, and task identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns Reminders ordered by their scheduled instant.
 * @throws TaskServiceError when access fails or the task does not exist.
 */
export async function listTaskReminders(
  input: ListTaskRemindersInput,
  deps: TaskServiceDeps = {}
): Promise<TaskReminder[]> {
  return runTaskOperation(
    "list_task_reminders",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
    },
    async (): Promise<TaskReminder[]> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:view",
        "You cannot view task reminders."
      )

      const task = await getTaskById(client, input.organizationId, input.taskId)

      return listTaskReminderRows(client, input.organizationId, task.id)
    }
  )
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
  return runTaskOperation(
    "process_due_task_reminders",
    { batchLimit: TASK_REMINDER_BATCH_LIMIT },
    async (): Promise<TaskReminderRunSummary> => {
      const client = getTaskClient(deps)
      const now = taskNow(deps)
      const nowIso = now.toISOString()
      const leaseCutoffIso = new Date(
        now.getTime() - TASK_REMINDER_LEASE_SECONDS * 1000
      ).toISOString()
      const dueReminders = await listDueTaskReminders(
        client,
        nowIso,
        leaseCutoffIso
      )
      const summary: TaskReminderRunSummary = {
        scannedCount: dueReminders.length,
        sentCount: 0,
        failedCount: 0,
        retryingCount: 0,
        skippedCount: 0,
      }

      if (dueReminders.length === 0) {
        return summary
      }

      const context = await loadDueReminderContext(client, dueReminders)

      for (const dueReminder of dueReminders) {
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
 * notify someone who is no longer the assignee.
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

      const record = deps.recordNotificationDelivery ?? defaultRecordNotificationDelivery
      const recipientUserId = task.assignedTo
      const emailReference = `task-assigned/${task.id}/${recipientUserId}/${task.assignedAt}`
      const sendEmail = deps.sendTaskEmail ?? defaultSendTaskEmail
      let emailDelivered = false

      if (recipient.emailNotificationsEnabled) {
        try {
          await sendEmail(
            createTaskEmailRequest("assigned", emailReference, task, recipient)
          )
          emailDelivered = true
          await record({
            organizationId: task.organizationId,
            recipientUserId,
            channel: "email",
            purpose: "task_assigned",
            reference: emailReference,
            status: "sent",
          })
        } catch (error: unknown) {
          await record({
            organizationId: task.organizationId,
            recipientUserId,
            channel: "email",
            purpose: "task_assigned",
            reference: emailReference,
            status: "failed",
            lastError: toSafeReminderFailureReason(error),
          })
          // Rethrown so the Inngest handler retries the assignment
          // notification instead of reporting a delivery that never happened.
          throw error
        }
      } else {
        await record({
          organizationId: task.organizationId,
          recipientUserId,
          channel: "email",
          purpose: "task_assigned",
          reference: emailReference,
          status: "suppressed",
        })
      }

      if (recipient.phoneNumber) {
        const smsReference = `task-assigned-sms/${task.id}/${recipientUserId}`

        if (recipient.smsNotificationsEnabled) {
          // Providers report failure by RETURNING {success:false}, so the
          // result must be inspected: a bare await would treat every provider
          // rejection as a success.
          const sendSmsImpl = deps.sendSms ?? defaultSendSms
          let smsFailure: string | null = null

          try {
            const smsResult = await sendSmsImpl({
              recipientPhone: recipient.phoneNumber,
              message: `Task Assigned: "${task.title}" has been assigned to you.`,
              reference: smsReference,
            })

            if (!smsResult.success) {
              smsFailure = smsResult.error ?? "SMS delivery failed."
            }
          } catch (error: unknown) {
            smsFailure = toSafeReminderFailureReason(error)
          }

          await record({
            organizationId: task.organizationId,
            recipientUserId,
            channel: "sms",
            purpose: "task_assigned",
            reference: smsReference,
            status: smsFailure === null ? "sent" : "failed",
            lastError: smsFailure,
          })

          if (smsFailure !== null) {
            console.warn("task_assignment_sms_failed", {
              taskId: task.id,
              organizationId: task.organizationId,
            })

            // Email is the primary channel. Failing the whole job when only SMS
            // broke would re-send an email the assignee already has, so the SMS
            // failure is recorded for retry rather than thrown — unless email
            // never went out either, in which case nothing reached them.
            if (!emailDelivered && !recipient.emailNotificationsEnabled) {
              throw new TaskServiceError(
                "Task assignment notification could not be delivered.",
                502
              )
            }
          }
        } else {
          await record({
            organizationId: task.organizationId,
            recipientUserId,
            channel: "sms",
            purpose: "task_assigned",
            reference: smsReference,
            status: "suppressed",
          })
        }
      }

      return { delivered: true, skippedReason: null }
    }
  )
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

  const record = deps.recordNotificationDelivery ?? defaultRecordNotificationDelivery
  const deliveryReference = `task-reminder/${reminder.id}`

  if (reminder.channel === "sms") {
    if (!recipient.smsNotificationsEnabled) {
      // Cancelled, not sent: nothing was handed to a provider, and recording
      // it as sent would make the reminder history claim a delivery that
      // never happened. Cancelling also stops it being rescanned forever.
      await markReminderOutcome(client, reminder, nowIso, {
        status: "cancelled",
        last_error: null,
      })
      await record({
        organizationId: reminder.organizationId,
        recipientUserId: reminder.recipientUserId,
        channel: "sms",
        purpose: "task_reminder",
        reference: deliveryReference,
        status: "suppressed",
      })
      return "skipped"
    }

    if (!recipient.phoneNumber) {
      await markReminderOutcome(client, reminder, nowIso, {
        status: "failed",
        last_error: "Reminder recipient has no phone number for SMS.",
      })
      return "failed"
    }

    try {
      const sendSmsImpl = deps.sendSms ?? defaultSendSms
      const smsResult = await sendSmsImpl({
        recipientPhone: recipient.phoneNumber,
        message: `Task Reminder: "${task.title}" is due. Check your task dashboard for details.`,
        reference: `task-reminder/${reminder.id}`,
      })

      if (!smsResult.success) {
        const errorMsg = smsResult.error ?? "SMS delivery failed."
        const retrying = reminder.attemptCount < TASK_REMINDER_MAX_ATTEMPTS
        await markReminderOutcome(client, reminder, nowIso, {
          status: retrying ? "pending" : "failed",
          last_error: errorMsg.slice(0, 500),
        })
        await record({
          organizationId: reminder.organizationId,
          recipientUserId: reminder.recipientUserId,
          channel: "sms",
          purpose: "task_reminder",
          reference: deliveryReference,
          status: "failed",
          attemptCount: reminder.attemptCount + 1,
          lastError: errorMsg,
        })
        return retrying ? "retrying" : "failed"
      }
    } catch (error: unknown) {
      const retrying = shouldRetryReminderDelivery(reminder, error)
      await markReminderOutcome(client, reminder, nowIso, {
        status: retrying ? "pending" : "failed",
        last_error: toSafeReminderFailureReason(error),
      })
      return retrying ? "retrying" : "failed"
    }
  } else {
    if (!recipient.emailNotificationsEnabled) {
      await markReminderOutcome(client, reminder, nowIso, {
        status: "cancelled",
        last_error: null,
      })
      await record({
        organizationId: reminder.organizationId,
        recipientUserId: reminder.recipientUserId,
        channel: "email",
        purpose: "task_reminder",
        reference: deliveryReference,
        status: "suppressed",
      })
      return "skipped"
    }

    try {
      const sendEmail = deps.sendTaskEmail ?? defaultSendTaskEmail
      await sendEmail(
        createTaskEmailRequest(
          "reminder",
          `task-reminder/${reminder.id}`,
          task,
          recipient
        )
      )
    } catch (error: unknown) {
      const retrying = shouldRetryReminderDelivery(reminder, error)
      await markReminderOutcome(client, reminder, nowIso, {
        status: retrying ? "pending" : "failed",
        last_error: toSafeReminderFailureReason(error),
      })
      return retrying ? "retrying" : "failed"
    }
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
    return "The reminder recipient is no longer an active member."
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
        .select("org_id,user_id,role,email_notifications_enabled,sms_notifications_enabled")
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

      if (
        !INTERNAL_RECIPIENT_ROLES.includes(membership.role) ||
        !contact?.email
      ) {
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
    .select("role, email_notifications_enabled, sms_notifications_enabled")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (membershipError) {
    throw createTaskDatabaseError(membershipError, "Unable to load task permissions.")
  }

  if (!membershipData || !INTERNAL_RECIPIENT_ROLES.includes(membershipData.role)) {
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
