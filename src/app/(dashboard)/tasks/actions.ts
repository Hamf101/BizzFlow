"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { publishTaskAssigned } from "@/inngest/publish-task-assigned"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect, getFormString } from "@/lib/form-utils"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  assignTask,
  cancelTaskReminder,
  createTask,
  scheduleTaskReminder,
  TaskServiceError,
  transitionTaskStatus,
  updateTask,
  type TaskServiceDeps,
} from "@/services/task-service"
import type { OrganizationContext } from "@/types/organization"
import { taskReminderChannelSchema, taskStatusSchema } from "@/types/task"

const TASKS_PATH = "/tasks"

// The service stays free of the background-job SDK, so the edge hands it the
// publisher. Without this, an assignment would never email the new assignee.
const TASK_NOTIFICATION_DEPS: TaskServiceDeps = { publishTaskAssigned }

type TaskActionContext = {
  actorUserId: string
  organizationId: string
}

type TaskActionRun = (context: TaskActionContext) => Promise<string>

class TaskActionError extends Error {
  /**
   * Creates a user-safe rejection raised by a task server action.
   *
   * @param message - Description shown to the member who submitted the form.
   */
  constructor(message: string) {
    super(message)
    this.name = "TaskActionError"
  }
}

const identifierSchema = z.string().uuid("Choose a valid record.")
const memberSchema = z.string().uuid("Choose a valid team member.")
const optionalMemberSchema = z.union([z.literal(""), memberSchema])
const titleSchema = z
  .string()
  .trim()
  .min(1, "Task title is required.")
  .max(200, "Task title must be 200 characters or fewer.")
const descriptionSchema = z
  .string()
  .trim()
  .max(5_000, "Task description must be 5,000 characters or fewer.")
const timestampSchema = z
  .string()
  .refine(
    (value: string): boolean => !Number.isNaN(Date.parse(value)),
    "Enter a valid date and time."
  )
const optionalTimestampSchema = z.union([z.literal(""), timestampSchema])
const expectedRevisionSchema = z.coerce
  .number()
  .int("Task revision must be a positive integer.")
  .positive("Task revision must be a positive integer.")

const createTaskSchema = z.object({
  assignedTo: optionalMemberSchema,
  description: descriptionSchema,
  dueAt: optionalTimestampSchema,
  submissionId: z.union([z.literal(""), identifierSchema]),
  title: titleSchema,
})

const updateTaskSchema = z.object({
  description: descriptionSchema,
  dueAt: optionalTimestampSchema,
  expectedRevision: expectedRevisionSchema,
  taskId: identifierSchema,
  title: titleSchema,
})

const assignTaskSchema = z.object({
  assignedTo: optionalMemberSchema,
  expectedRevision: expectedRevisionSchema,
  taskId: identifierSchema,
})

const transitionTaskSchema = z.object({
  expectedRevision: expectedRevisionSchema,
  targetStatus: taskStatusSchema,
  taskId: identifierSchema,
})

const scheduleReminderSchema = z.object({
  channel: z.union([z.literal(""), taskReminderChannelSchema]),
  recipientUserId: memberSchema,
  remindAt: timestampSchema,
  taskId: identifierSchema,
})

const cancelReminderSchema = z.object({
  reminderId: identifierSchema,
  taskId: identifierSchema,
})

/**
 * Creates a task for the current organization, optionally pre-assigned.
 *
 * A task may be raised from a submission, in which case a failure returns the
 * member to that submission rather than to the task workspace.
 *
 * @param formData - Title, description, due instant, assignee, and submission.
 * @returns Never returns; redirects to the new task or back with an error.
 */
export async function createTaskAction(formData: FormData): Promise<void> {
  const submissionId = getFormString(formData, "submissionId")

  await runTaskAction({
    errorPath: getSubmissionPath(submissionId) ?? TASKS_PATH,
    eventName: "task_create_action",
    fallback: "Unable to create this task.",
    permission: "tasks:create",
    successMessage: "Task created.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(createTaskSchema, {
        assignedTo: getFormString(formData, "assignedTo"),
        description: getFormString(formData, "description"),
        dueAt: getFormString(formData, "dueAt"),
        submissionId,
        title: getFormString(formData, "title"),
      })
      const task = await createTask(
        {
          actorUserId: context.actorUserId,
          assignedTo: toNullableValue(input.assignedTo),
          description: toNullableValue(input.description),
          dueAt: toNullableValue(input.dueAt),
          organizationId: context.organizationId,
          submissionId: toNullableValue(input.submissionId),
          title: input.title,
        },
        TASK_NOTIFICATION_DEPS
      )

      return getTaskPath(task.id)
    },
  })
}

/**
 * Edits the descriptive fields of a task that is still open for changes.
 *
 * @param formData - Task id, expected revision, title, description, due instant.
 * @returns Never returns; redirects to the refreshed task or an error.
 */
export async function updateTaskAction(formData: FormData): Promise<void> {
  const taskPath = getTaskPath(getFormString(formData, "taskId"))

  await runTaskAction({
    errorPath: taskPath,
    eventName: "task_update_action",
    fallback: "Unable to update this task.",
    permission: "tasks:edit",
    successMessage: "Task details saved.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(updateTaskSchema, {
        description: getFormString(formData, "description"),
        dueAt: getFormString(formData, "dueAt"),
        expectedRevision: getFormString(formData, "expectedRevision"),
        taskId: getFormString(formData, "taskId"),
        title: getFormString(formData, "title"),
      })
      await updateTask({
        actorUserId: context.actorUserId,
        description: toNullableValue(input.description),
        dueAt: toNullableValue(input.dueAt),
        expectedRevision: input.expectedRevision,
        organizationId: context.organizationId,
        taskId: input.taskId,
        title: input.title,
      })

      return getTaskPath(input.taskId)
    },
  })
}

/**
 * Assigns, reassigns, or clears the assignee of an open task.
 *
 * @param formData - Task id, expected revision, and the chosen member.
 * @returns Never returns; redirects to the refreshed task or an error.
 */
export async function assignTaskAction(formData: FormData): Promise<void> {
  const taskPath = getTaskPath(getFormString(formData, "taskId"))

  await runTaskAction({
    errorPath: taskPath,
    eventName: "task_assign_action",
    fallback: "Unable to change this task assignment.",
    permission: "tasks:assign",
    successMessage: "Task assignment saved.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(assignTaskSchema, {
        assignedTo: getFormString(formData, "assignedTo"),
        expectedRevision: getFormString(formData, "expectedRevision"),
        taskId: getFormString(formData, "taskId"),
      })
      await assignTask(
        {
          actorUserId: context.actorUserId,
          assignedTo: toNullableValue(input.assignedTo),
          expectedRevision: input.expectedRevision,
          organizationId: context.organizationId,
          taskId: input.taskId,
        },
        TASK_NOTIFICATION_DEPS
      )

      return getTaskPath(input.taskId)
    },
  })
}

/**
 * Applies one lifecycle change allowed by the task state machine.
 *
 * @param formData - Task id, expected revision, and the requested status.
 * @returns Never returns; redirects to the refreshed task or an error.
 */
export async function transitionTaskStatusAction(
  formData: FormData
): Promise<void> {
  const taskPath = getTaskPath(getFormString(formData, "taskId"))

  await runTaskAction({
    errorPath: taskPath,
    eventName: "task_transition_action",
    fallback: "Unable to update this task status.",
    permission: "tasks:edit",
    successMessage: "Task status updated.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(transitionTaskSchema, {
        expectedRevision: getFormString(formData, "expectedRevision"),
        targetStatus: getFormString(formData, "targetStatus"),
        taskId: getFormString(formData, "taskId"),
      })
      await transitionTaskStatus({
        actorUserId: context.actorUserId,
        expectedRevision: input.expectedRevision,
        organizationId: context.organizationId,
        targetStatus: input.targetStatus,
        taskId: input.taskId,
      })

      return getTaskPath(input.taskId)
    },
  })
}

/**
 * Schedules one future email reminder for a member on an open task.
 *
 * @param formData - Task id, recipient member, and the reminder instant.
 * @returns Never returns; redirects to the refreshed task or an error.
 */
export async function scheduleTaskReminderAction(
  formData: FormData
): Promise<void> {
  const taskPath = getTaskPath(getFormString(formData, "taskId"))

  await runTaskAction({
    errorPath: taskPath,
    eventName: "task_reminder_schedule_action",
    fallback: "Unable to schedule this reminder.",
    permission: "tasks:edit",
    successMessage: "Reminder scheduled.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(scheduleReminderSchema, {
        channel: getFormString(formData, "channel"),
        recipientUserId: getFormString(formData, "recipientUserId"),
        remindAt: getFormString(formData, "remindAt"),
        taskId: getFormString(formData, "taskId"),
      })
      await scheduleTaskReminder({
        actorUserId: context.actorUserId,
        channel: input.channel === "" ? "email" : input.channel,
        organizationId: context.organizationId,
        recipientUserId: input.recipientUserId,
        remindAt: input.remindAt,
        taskId: input.taskId,
      })

      return getTaskPath(input.taskId)
    },
  })
}

/**
 * Cancels one pending reminder without removing its delivery history.
 *
 * @param formData - Task id and the reminder being cancelled.
 * @returns Never returns; redirects to the refreshed task or an error.
 */
export async function cancelTaskReminderAction(
  formData: FormData
): Promise<void> {
  const taskPath = getTaskPath(getFormString(formData, "taskId"))

  await runTaskAction({
    errorPath: taskPath,
    eventName: "task_reminder_cancel_action",
    fallback: "Unable to cancel this reminder.",
    permission: "tasks:edit",
    successMessage: "Reminder cancelled.",
    run: async (context: TaskActionContext): Promise<string> => {
      const input = parseTaskActionInput(cancelReminderSchema, {
        reminderId: getFormString(formData, "reminderId"),
        taskId: getFormString(formData, "taskId"),
      })
      await cancelTaskReminder({
        actorUserId: context.actorUserId,
        organizationId: context.organizationId,
        reminderId: input.reminderId,
        taskId: input.taskId,
      })

      return getTaskPath(input.taskId)
    },
  })
}

async function runTaskAction(input: {
  errorPath: string
  eventName: string
  fallback: string
  permission: OrganizationPermissionAction
  run: TaskActionRun
  successMessage: string
}): Promise<never> {
  const startedAt = Date.now()
  let successPath = input.errorPath

  try {
    const context = await loadTaskActionContext(input.permission)
    successPath = await input.run(context)
    // The origin page is refreshed too, so a task raised from a submission
    // appears on that submission without a manual reload.
    revalidateTaskPaths([TASKS_PATH, input.errorPath, successPath])

    console.info(`${input.eventName}_completed`, {
      durationMs: Date.now() - startedAt,
      organizationId: context.organizationId,
    })
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: input.errorPath }))
    }

    const reason = getTaskActionErrorMessage(error, input.fallback)
    console.warn(`${input.eventName}_failed`, {
      durationMs: Date.now() - startedAt,
      reason,
    })
    redirect(buildRedirect(input.errorPath, { error: reason }))
  }

  redirect(buildRedirect(successPath, { message: input.successMessage }))
}

async function loadTaskActionContext(
  permission: OrganizationPermissionAction
): Promise<TaskActionContext> {
  const user = await getAuthenticatedUser()
  const context: OrganizationContext | null =
    await getCurrentOrganizationContext(user.id)

  if (!context) {
    throw new TaskActionError("Create an organization before managing tasks.")
  }

  if (!canPerformOrganizationAction(context.membership.role, permission)) {
    throw new TaskActionError(
      "You do not have permission to perform this task action."
    )
  }

  return { actorUserId: user.id, organizationId: context.organization.id }
}

function parseTaskActionInput<TValue>(
  schema: z.ZodType<TValue>,
  value: unknown
): TValue {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new TaskActionError(
      result.error.issues[0]?.message ?? "Check the task details and try again."
    )
  }

  return result.data
}

function getTaskActionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof TaskActionError || error instanceof TaskServiceError
    ? error.message
    : fallback
}

function toNullableValue(value: string): string | null {
  return value === "" ? null : value
}

function getTaskPath(taskId: string): string {
  const identifier = taskId.trim()

  return identifier ? `/tasks/${encodeURIComponent(identifier)}` : TASKS_PATH
}

function getSubmissionPath(submissionId: string): string | null {
  const identifier = submissionId.trim()

  return identifier ? `/submissions/${encodeURIComponent(identifier)}` : null
}

function revalidateTaskPaths(paths: readonly string[]): void {
  new Set(paths).forEach((path: string): void => {
    revalidatePath(path)
  })
}
