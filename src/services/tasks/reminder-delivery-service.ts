import type {
  NotifyTaskAssigneeInput,
  TaskNotificationResult,
  TaskReminderRunSummary,
  TaskServiceClient,
  TaskServiceDeps,
} from "@/services/tasks/contracts"
import { TaskServiceError } from "@/services/tasks/errors"
import {
  canReceiveTaskWork,
  createTaskDatabaseError,
  getTaskById,
  getTaskClient,
  runTaskOperation,
  taskNow,
  TASK_COLUMNS,
  TASK_REMINDER_COLUMNS,
} from "@/services/tasks/shared"
import {
  loadOrganizationNotificationSettingsMap,
  recordNotificationDelivery as defaultRecordNotificationDelivery,
  type OrganizationNotificationSettings,
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

type TaskReminderRecipient = {
  email: string
  fullName: string | null
  phoneNumber: string | null
  /** True only when BOTH the organization and the member allow the channel. */
  emailNotificationsEnabled: boolean
  smsNotificationsEnabled: boolean
}

const PROFILE_CONTACT_COLUMNS = "id,email,full_name,phone_number"

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
  // tenant-scope: the reminder cron delivers due reminders for every organization by design
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
      // tenant-scope: ids come from due reminders; a task whose org_id differs from its reminder is skipped
      client.from("tasks").select(TASK_COLUMNS).in("id", taskIds),
      client
        .from("profiles")
        .select(PROFILE_CONTACT_COLUMNS)
        .in("id", recipientIds),
      // tenant-scope: cross-organization cron: rows are keyed by (org_id, user_id) and matched to each reminder's org
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

      recipients.set(
        createRecipientKey(membership.org_id, membership.user_id),
        toTaskRecipient(contact.email, contact, membership, organizationSettings.get(membership.org_id))
      )
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

  const { data, error } = await client
    .from("profiles")
    .select(PROFILE_CONTACT_COLUMNS)
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load the task recipient.")
  }

  const contact = data as ProfileContactRow | null

  return contact?.email
    ? toTaskRecipient(contact.email, contact, membershipData, organizationSettings.get(organizationId))
    : null
}

// The organization switch gates the member preference: a channel the
// organization turned off cannot be re-enabled by an individual.
function toTaskRecipient(
  email: string,
  contact: ProfileContactRow,
  membership: { email_notifications_enabled: boolean; sms_notifications_enabled: boolean },
  organizationSettings: OrganizationNotificationSettings = {
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: true,
  }
): TaskReminderRecipient {
  return {
    email,
    fullName: contact.full_name,
    phoneNumber: contact.phone_number,
    emailNotificationsEnabled: isNotificationChannelEnabled({
      organizationEnabled: organizationSettings.emailNotificationsEnabled,
      memberEnabled: membership.email_notifications_enabled,
    }),
    smsNotificationsEnabled: isNotificationChannelEnabled({
      organizationEnabled: organizationSettings.smsNotificationsEnabled,
      memberEnabled: membership.sms_notifications_enabled,
    }),
  }
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

function toSafeReminderFailureReason(error: unknown): string {
  const message =
    error instanceof TaskServiceError
      ? error.message
      : "Task reminder delivery failed."

  return message.slice(0, 500)
}
