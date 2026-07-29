import { z } from "zod"

const uuidSchema = z.string().uuid()
const timestampSchema = z.string().datetime({ offset: true })

/** Lifecycle states implemented by the task workflow. */
export const TASK_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled",
] as const

/** Delivery states implemented by the task reminder scheduler. */
export const TASK_REMINDER_STATUSES = [
  "pending",
  "sent",
  "failed",
  "cancelled",
] as const

/** Delivery channels available to task reminders. */
export const TASK_REMINDER_CHANNELS = ["email"] as const

/** Lifecycle state of one task. */
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Delivery state of one scheduled task reminder. */
export type TaskReminderStatus = (typeof TASK_REMINDER_STATUSES)[number]

/** Delivery channel of one scheduled task reminder. */
export type TaskReminderChannel = (typeof TASK_REMINDER_CHANNELS)[number]

/** Zod contract for a persisted task lifecycle state. */
export const taskStatusSchema = z.enum(TASK_STATUSES)

/** Zod contract for a persisted task reminder delivery state. */
export const taskReminderStatusSchema = z.enum(TASK_REMINDER_STATUSES)

/** Zod contract for a persisted task reminder delivery channel. */
export const taskReminderChannelSchema = z.enum(TASK_REMINDER_CHANNELS)

/**
 * Status changes the task service is allowed to apply, keyed by current status.
 *
 * `completed` and `cancelled` are terminal: they accept no further transition.
 */
export const TASK_STATUS_TRANSITIONS: Readonly<
  Record<TaskStatus, readonly TaskStatus[]>
> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

const incompleteTaskRowShape = {
  status: z.enum(["open", "in_progress", "cancelled"]),
  completed_at: z.null(),
} as const

const completedTaskRowShape = {
  status: z.literal("completed"),
  completed_at: timestampSchema,
} as const

const unassignedTaskRowShape = {
  assigned_to: z.null(),
  assigned_by: z.null(),
  assigned_at: z.null(),
} as const

const assignedTaskRowShape = {
  assigned_to: uuidSchema,
  assigned_by: uuidSchema,
  assigned_at: timestampSchema,
} as const

const taskRowShape = {
  id: uuidSchema,
  org_id: uuidSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5_000).nullable(),
  due_at: timestampSchema.nullable(),
  submission_id: uuidSchema.nullable(),
  created_by: uuidSchema,
  updated_by: uuidSchema,
  revision: z.number().int().positive(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
} as const

/**
 * Zod contract for one `public.tasks` row.
 *
 * The union mirrors the table's state constraints: the assignment triple is
 * all-null or all-set, and `completed_at` is present exactly when the task is
 * completed.
 */
export const taskSchema = z.union([
  z.object({
    ...taskRowShape,
    ...incompleteTaskRowShape,
    ...unassignedTaskRowShape,
  }),
  z.object({
    ...taskRowShape,
    ...incompleteTaskRowShape,
    ...assignedTaskRowShape,
  }),
  z.object({
    ...taskRowShape,
    ...completedTaskRowShape,
    ...unassignedTaskRowShape,
  }),
  z.object({
    ...taskRowShape,
    ...completedTaskRowShape,
    ...assignedTaskRowShape,
  }),
])

const taskReminderRowShape = {
  id: uuidSchema,
  org_id: uuidSchema,
  task_id: uuidSchema,
  recipient_user_id: uuidSchema,
  remind_at: timestampSchema,
  channel: taskReminderChannelSchema,
  attempt_count: z.number().int().min(0),
  last_error: z.string().trim().min(1).max(500).nullable(),
  created_by: uuidSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
} as const

/**
 * Zod contract for one `public.task_reminders` row.
 *
 * The union mirrors the table's send-state constraint: `sent_at` is present
 * exactly when the reminder has been sent.
 */
export const taskReminderSchema = z.union([
  z.object({
    ...taskReminderRowShape,
    status: z.enum(["pending", "failed", "cancelled"]),
    sent_at: z.null(),
  }),
  z.object({
    ...taskReminderRowShape,
    status: z.literal("sent"),
    sent_at: timestampSchema,
  }),
])

/** Stable machine-readable reason for a task domain rejection. */
export type TaskDomainErrorCode = "invalid_task_reminder_row" | "invalid_task_row"

/** Error raised when task data violates the domain contract. */
export class TaskDomainError extends Error {
  readonly code: TaskDomainErrorCode
  readonly statusCode: number

  /**
   * Creates an HTTP-translatable task domain error.
   *
   * @param message - User-safe description of the rejected data.
   * @param code - Stable reason callers can use without parsing the message.
   * @param statusCode - HTTP-style status code for the calling boundary.
   */
  constructor(message: string, code: TaskDomainErrorCode, statusCode: number) {
    super(message)
    this.name = "TaskDomainError"
    this.code = code
    this.statusCode = statusCode
  }
}

/** Assignment metadata, recorded as a whole or not at all. */
export type TaskAssignment =
  | { assignedTo: null; assignedBy: null; assignedAt: null }
  | { assignedTo: string; assignedBy: string; assignedAt: string }

/** Completion metadata, recorded exactly when the task is completed. */
export type TaskCompletion =
  | { status: Exclude<TaskStatus, "completed">; completedAt: null }
  | { status: "completed"; completedAt: string }

/** Fields shared by every task lifecycle state. */
export type TaskBase = {
  id: string
  organizationId: string
  title: string
  description: string | null
  dueAt: string | null
  submissionId: string | null
  createdBy: string
  updatedBy: string
  revision: number
  createdAt: string
  updatedAt: string
}

/** Tenant-scoped task in one of the Sprint 9 lifecycle states. */
export type Task = TaskBase & TaskAssignment & TaskCompletion

/** Send metadata, recorded exactly when the reminder has been sent. */
export type TaskReminderDelivery =
  | { status: Exclude<TaskReminderStatus, "sent">; sentAt: null }
  | { status: "sent"; sentAt: string }

/** Fields shared by every task reminder delivery state. */
export type TaskReminderBase = {
  id: string
  organizationId: string
  taskId: string
  recipientUserId: string
  remindAt: string
  channel: TaskReminderChannel
  attemptCount: number
  lastError: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** Tenant-scoped reminder scheduled against one task. */
export type TaskReminder = TaskReminderBase & TaskReminderDelivery

/**
 * Reports whether a task status accepts no further transition.
 *
 * @param status - Current task status.
 * @returns True when the status is terminal.
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[status].length === 0
}

/**
 * Reports whether the task service may move a task between two statuses.
 *
 * @param from - Current task status.
 * @param to - Requested next task status.
 * @returns True when the transition is allowed by the domain contract.
 */
export function canTransitionTaskStatus(
  from: TaskStatus,
  to: TaskStatus
): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Parses an unknown database or RPC row into a typed task.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case task data.
 * @throws TaskDomainError when the row violates the persistence contract.
 */
export function parseTaskRow(value: unknown): Task {
  const result = taskSchema.safeParse(value)

  if (!result.success) {
    throw new TaskDomainError(
      "Database returned an invalid task record.",
      "invalid_task_row",
      500
    )
  }

  const row = result.data
  const taskBase: TaskBase = {
    id: row.id,
    organizationId: row.org_id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at,
    submissionId: row.submission_id,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  const assignment: TaskAssignment =
    row.assigned_to === null
      ? { assignedTo: null, assignedBy: null, assignedAt: null }
      : {
          assignedTo: row.assigned_to,
          assignedBy: row.assigned_by,
          assignedAt: row.assigned_at,
        }

  if (row.status === "completed") {
    return {
      ...taskBase,
      ...assignment,
      status: "completed",
      completedAt: row.completed_at,
    }
  }

  return {
    ...taskBase,
    ...assignment,
    status: row.status,
    completedAt: null,
  }
}

/**
 * Parses an unknown database or RPC row into a typed task reminder.
 *
 * @param value - Untrusted persistence data.
 * @returns Canonical camel-case reminder data.
 * @throws TaskDomainError when the row violates the persistence contract.
 */
export function parseTaskReminderRow(value: unknown): TaskReminder {
  const result = taskReminderSchema.safeParse(value)

  if (!result.success) {
    throw new TaskDomainError(
      "Database returned an invalid task reminder record.",
      "invalid_task_reminder_row",
      500
    )
  }

  const row = result.data
  const reminderBase: TaskReminderBase = {
    id: row.id,
    organizationId: row.org_id,
    taskId: row.task_id,
    recipientUserId: row.recipient_user_id,
    remindAt: row.remind_at,
    channel: row.channel,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  return row.status === "sent"
    ? { ...reminderBase, status: "sent", sentAt: row.sent_at }
    : { ...reminderBase, status: row.status, sentAt: null }
}
