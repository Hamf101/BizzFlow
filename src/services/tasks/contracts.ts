import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { RecordNotificationDeliveryInput } from "@/services/notification-service"
import type { SendSmsInput, SendSmsResult } from "@/services/sms-service"
import type { SendTaskEmailInput } from "@/services/tasks/task-email"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"
import type { Task, TaskReminder, TaskReminderChannel, TaskStatus } from "@/types/task"

/** Narrow trusted Supabase client used by task services. */
export type TaskServiceClient = Pick<AdminSupabaseClient, "from">

/** Scalar values permitted in task operation logs. */
export type TaskLogValue = string | number | boolean | null | undefined

/** Audit event payload written by task operations. */
export type TaskAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string
  metadata: AuditMetadata
}

/**
 * Identifiers published when a task gains an assignee.
 *
 * The service never imports the background-job SDK; an edge supplies the
 * publisher so the payload stays identifier-only and handlers re-read the task.
 */
export type TaskAssignedNotification = {
  organizationId: string
  taskId: string
  assignedToUserId: string
  assignedByUserId: string
}

/** Actor and tenant identifiers shared by every task call. */
export type TaskActorInput = {
  actorUserId: string
  organizationId: string
}

/** Input for listing tenant tasks with optional workspace filters. */
export type ListTasksInput = TaskActorInput & {
  statuses?: readonly TaskStatus[]
  assignedTo?: string
  submissionId?: string
  limit?: number
}

/** Input for loading one tenant task with its reminders. */
export type GetTaskInput = TaskActorInput & {
  taskId: string
}

/** Input for creating a task, optionally linked to a submission. */
export type CreateTaskInput = TaskActorInput & {
  title: string
  description?: string | null
  dueAt?: string | null
  submissionId?: string | null
  assignedTo?: string | null
}

/** Input for editing the descriptive fields of an active task. */
export type UpdateTaskInput = GetTaskInput & {
  expectedRevision: number
  title?: string
  description?: string | null
  dueAt?: string | null
}

/** Input for assigning, reassigning, or clearing a task assignee. */
export type AssignTaskInput = GetTaskInput & {
  expectedRevision: number
  assignedTo: string | null
}

/** Input for one binding task lifecycle change. */
export type TransitionTaskStatusInput = GetTaskInput & {
  expectedRevision: number
  targetStatus: TaskStatus
}

/** Task with the reminders scheduled against it. */
export type TaskDetail = {
  task: Task
  reminders: TaskReminder[]
}

/** Input for scheduling one future reminder for a task recipient. */
export type ScheduleTaskReminderInput = GetTaskInput & {
  recipientUserId: string
  remindAt: string
  channel?: TaskReminderChannel
}

/** Input for cancelling one pending task reminder. */
export type CancelTaskReminderInput = GetTaskInput & {
  reminderId: string
}

/** Input for listing the reminders scheduled against one task. */
export type ListTaskRemindersInput = GetTaskInput

/** Input for the trusted assignment notification job. */
export type NotifyTaskAssigneeInput = {
  organizationId: string
  taskId: string
  assignedToUserId: string
}

/** Reason a trusted notification was skipped instead of delivered. */
export type TaskNotificationSkipReason =
  | "assignment_changed"
  | "recipient_unavailable"
  | "task_closed"

/** Outcome of one trusted assignment notification attempt. */
export type TaskNotificationResult = {
  delivered: boolean
  skippedReason: TaskNotificationSkipReason | null
}

/** Counters returned by one bounded due-reminder pass. */
export type TaskReminderRunSummary = {
  scannedCount: number
  sentCount: number
  failedCount: number
  retryingCount: number
  skippedCount: number
}

/** Optional dependencies accepted by task services and focused tests. */
export type TaskServiceDeps = {
  client?: TaskServiceClient
  createId?: () => string
  now?: () => Date
  recordAuditLog?: (input: TaskAuditLogInput) => Promise<unknown>
  sendTaskEmail?: (input: SendTaskEmailInput) => Promise<void>
  sendSms?: (input: SendSmsInput) => Promise<SendSmsResult>
  publishTaskAssigned?: (event: TaskAssignedNotification) => Promise<unknown>
  recordNotificationDelivery?: (
    input: RecordNotificationDeliveryInput
  ) => Promise<unknown>
}
