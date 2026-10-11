"use server"

import { revalidatePath } from "next/cache"
import * as z from "zod"

import { publishTaskAssigned } from "@/inngest/publish-task-assigned"
import type { ActionFeedbackCode } from "@/lib/action-result"
import {
  ActionError,
  loadActionContext,
  runFormAction,
  type ActionActor,
} from "@/lib/form-action"
import { getFormString } from "@/lib/form-utils"
import {
  assignTask,
  cancelTaskReminder,
  createTask,
  scheduleTaskReminder,
  transitionTaskStatus,
  updateTask,
  type TaskServiceDeps,
} from "@/services/task-service"
import { taskReminderChannelSchema, taskStatusSchema } from "@/types/task"

const TASKS_PATH = "/tasks"

// The service stays free of the background-job SDK, so the edge hands it the
// publisher. Without this, an assignment would never email the new assignee.
const TASK_NOTIFICATION_DEPS: TaskServiceDeps = { publishTaskAssigned }

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
    successCode: "task_created",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(createTaskSchema, {
        assignedTo: getFormString(formData, "assignedTo"),
        description: getFormString(formData, "description"),
        dueAt: getFormString(formData, "dueAt"),
        submissionId,
        title: getFormString(formData, "title"),
      })
      const task = await createTask(
        {
          ...context,
          assignedTo: toNullableValue(input.assignedTo),
          description: toNullableValue(input.description),
          dueAt: toNullableValue(input.dueAt),
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
    successCode: "changes_saved",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(updateTaskSchema, {
        description: getFormString(formData, "description"),
        dueAt: getFormString(formData, "dueAt"),
        expectedRevision: getFormString(formData, "expectedRevision"),
        taskId: getFormString(formData, "taskId"),
        title: getFormString(formData, "title"),
      })
      await updateTask({
        ...context,
        description: toNullableValue(input.description),
        dueAt: toNullableValue(input.dueAt),
        expectedRevision: input.expectedRevision,
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
    successCode: "changes_saved",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(assignTaskSchema, {
        assignedTo: getFormString(formData, "assignedTo"),
        expectedRevision: getFormString(formData, "expectedRevision"),
        taskId: getFormString(formData, "taskId"),
      })
      await assignTask(
        {
          ...context,
          assignedTo: toNullableValue(input.assignedTo),
          expectedRevision: input.expectedRevision,
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
    successCode: "task_status_updated",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(transitionTaskSchema, {
        expectedRevision: getFormString(formData, "expectedRevision"),
        targetStatus: getFormString(formData, "targetStatus"),
        taskId: getFormString(formData, "taskId"),
      })
      await transitionTaskStatus({
        ...context,
        expectedRevision: input.expectedRevision,
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
    successCode: "changes_saved",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(scheduleReminderSchema, {
        channel: getFormString(formData, "channel"),
        recipientUserId: getFormString(formData, "recipientUserId"),
        remindAt: getFormString(formData, "remindAt"),
        taskId: getFormString(formData, "taskId"),
      })
      await scheduleTaskReminder({
        ...context,
        channel: input.channel === "" ? "email" : input.channel,
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
    successCode: "changes_saved",
    run: async (context: ActionActor): Promise<string> => {
      const input = parseTaskActionInput(cancelReminderSchema, {
        reminderId: getFormString(formData, "reminderId"),
        taskId: getFormString(formData, "taskId"),
      })
      await cancelTaskReminder({
        ...context,
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
  run: (context: ActionActor) => Promise<string>
  successCode: ActionFeedbackCode
}): Promise<never> {
  return runFormAction({
    event: input.eventName,
    path: input.errorPath,
    success: input.successCode,
    run: async () => {
      const { actor } = await loadActionContext("Create an organization before managing tasks.")
      const successPath = await input.run(actor)
      // The origin page is refreshed too, so a task raised from a submission
      // appears on that submission without a manual reload.
      new Set([TASKS_PATH, input.errorPath, successPath]).forEach((path: string): void => {
        revalidatePath(path)
      })

      return { path: successPath }
    },
  })
}

function parseTaskActionInput<TValue>(
  schema: z.ZodType<TValue>,
  value: unknown
): TValue {
  const result = schema.safeParse(value)

  if (!result.success) {
    throw new ActionError(
      result.error.issues[0]?.message ?? "Check the task details and try again."
    )
  }

  return result.data
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
