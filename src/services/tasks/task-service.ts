import type {
  AssignTaskInput,
  CreateTaskInput,
  GetTaskInput,
  ListTasksInput,
  TaskAssignedNotification,
  TaskDetail,
  TaskServiceClient,
  TaskServiceDeps,
  TransitionTaskStatusInput,
  UpdateTaskInput,
} from "@/services/tasks/contracts"
import { TaskServiceError } from "@/services/tasks/errors"
import { syncAutomaticTaskReminder } from "@/services/tasks/reminder-service"
import {
  applyTaskMutation,
  assertTaskIsOpenForChanges,
  createTaskDatabaseError,
  createTaskId,
  getTaskById,
  getTaskClient,
  listTaskReminderRows,
  normalizeExpectedTaskRevision,
  normalizeOptionalTaskUuid,
  normalizeTaskDescription,
  normalizeTaskListLimit,
  normalizeTaskStatusFilter,
  normalizeTaskTimestamp,
  normalizeTaskTitle,
  normalizeTaskUuid,
  recordTaskAuditLog,
  requireInternalTaskMember,
  requireTaskPermission,
  requireTenantSubmission,
  runTaskOperation,
  taskNowIso,
  TASK_COLUMNS,
  type TaskMutationValues,
} from "@/services/tasks/shared"
import {
  canTransitionTaskStatus,
  parseTaskRow,
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from "@/types/task"

const ASSIGNEE_REJECTION_MESSAGE =
  "Task assignee must be an active internal member of this organization."

/**
 * Creates a task, optionally linked to a submission and pre-assigned.
 *
 * Pre-assignment is a privileged shortcut: the actor must also hold the
 * assignment permission, and the assignee must be an active internal member.
 *
 * @param input - Actor, tenant, and untrusted task details.
 * @param deps - Optional database, identifier, clock, audit, and publish deps.
 * @returns Created task at revision 1.
 * @throws TaskServiceError when access, validation, or persistence fails.
 */
export async function createTask(
  input: CreateTaskInput,
  deps: TaskServiceDeps = {}
): Promise<Task> {
  return runTaskOperation(
    "create_task",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<Task> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:create",
        "You cannot create tasks."
      )

      const title = normalizeTaskTitle(input.title)
      const description = normalizeTaskDescription(input.description)
      const dueAt = normalizeTaskTimestamp(
        input.dueAt,
        "Task due date must be a valid timestamp."
      )
      const submissionId = normalizeOptionalTaskUuid(
        input.submissionId,
        "Linked submission must be a valid submission id."
      )
      const assignedTo = normalizeOptionalTaskUuid(
        input.assignedTo,
        "Task assignee must be a valid user id."
      )

      if (submissionId !== null) {
        await requireTenantSubmission(client, input.organizationId, submissionId)
      }

      if (assignedTo !== null) {
        await requireTaskPermission(
          client,
          input.organizationId,
          input.actorUserId,
          "tasks:assign",
          "You cannot assign tasks."
        )
        await requireInternalTaskMember(
          client,
          input.organizationId,
          assignedTo,
          ASSIGNEE_REJECTION_MESSAGE
        )
      }

      const now = taskNowIso(deps)
      const { data, error } = await client
        .from("tasks")
        .insert({
          id: createTaskId(deps),
          org_id: input.organizationId,
          title,
          description,
          status: "open",
          due_at: dueAt,
          assigned_to: assignedTo,
          assigned_by: assignedTo === null ? null : input.actorUserId,
          assigned_at: assignedTo === null ? null : now,
          submission_id: submissionId,
          created_by: input.actorUserId,
          updated_by: input.actorUserId,
          completed_at: null,
          revision: 1,
          created_at: now,
          updated_at: now,
        })
        .select(TASK_COLUMNS)
        .maybeSingle()

      if (error || !data) {
        throw createTaskDatabaseError(error, "Unable to create task.")
      }

      const task = parseTaskRow(data)
      await recordTaskAuditLog(deps, {
        organizationId: task.organizationId,
        actorUserId: input.actorUserId,
        action: "task.created",
        targetType: "task",
        targetId: task.id,
        metadata: {
          status: task.status,
          submissionId: task.submissionId,
          assignedTo: task.assignedTo,
          dueAt: task.dueAt,
        },
      })
      await syncAutomaticTaskReminder(client, deps, task, input.actorUserId)
      await publishTaskAssignment(deps, task, input.actorUserId)

      return task
    }
  )
}

/**
 * Lists tenant tasks, optionally narrowed by status, assignee, or submission.
 *
 * @param input - Actor, tenant, and optional workspace filters.
 * @param deps - Optional trusted database dependency.
 * @returns Tasks ordered by due date, then most recently created.
 * @throws TaskServiceError when access, validation, or the query fails.
 */
export async function listTasks(
  input: ListTasksInput,
  deps: TaskServiceDeps = {}
): Promise<Task[]> {
  return runTaskOperation(
    "list_tasks",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
    },
    async (): Promise<Task[]> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:view",
        "You cannot view tasks."
      )

      const statuses = normalizeTaskStatusFilter(input.statuses)
      const assignedTo = normalizeOptionalTaskUuid(
        input.assignedTo,
        "Task assignee filter must be a valid user id."
      )
      const submissionId = normalizeOptionalTaskUuid(
        input.submissionId,
        "Task submission filter must be a valid submission id."
      )
      let query = client
        .from("tasks")
        .select(TASK_COLUMNS)
        .eq("org_id", input.organizationId)

      if (statuses !== null) {
        query = query.in("status", statuses)
      }

      if (assignedTo !== null) {
        query = query.eq("assigned_to", assignedTo)
      }

      if (submissionId !== null) {
        query = query.eq("submission_id", submissionId)
      }

      const { data, error } = await query
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(normalizeTaskListLimit(input.limit))

      if (error || !data) {
        throw createTaskDatabaseError(error, "Unable to load tasks.")
      }

      return data.map(parseTaskRow)
    }
  )
}

/**
 * Loads one tenant task together with its scheduled reminders.
 *
 * @param input - Actor, tenant, and task identifiers.
 * @param deps - Optional trusted database dependency.
 * @returns Task detail for the task workspace.
 * @throws TaskServiceError when access fails or the task does not exist.
 */
export async function getTask(
  input: GetTaskInput,
  deps: TaskServiceDeps = {}
): Promise<TaskDetail> {
  return runTaskOperation(
    "get_task",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
    },
    async (): Promise<TaskDetail> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:view",
        "You cannot view tasks."
      )

      const task = await getTaskById(client, input.organizationId, input.taskId)
      const reminders = await listTaskReminderRows(
        client,
        input.organizationId,
        task.id
      )

      return { task, reminders }
    }
  )
}

/**
 * Edits the descriptive fields of a task that has not been closed.
 *
 * @param input - Actor, tenant, expected revision, and changed fields.
 * @param deps - Optional database, clock, and audit dependencies.
 * @returns Updated task at its next revision.
 * @throws TaskServiceError when access, validation, state, or the write fails.
 */
export async function updateTask(
  input: UpdateTaskInput,
  deps: TaskServiceDeps = {}
): Promise<Task> {
  return runTaskOperation(
    "update_task",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
    },
    async (): Promise<Task> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:edit",
        "You cannot edit tasks."
      )

      const expectedRevision = normalizeExpectedTaskRevision(
        input.expectedRevision
      )
      const task = await requireEditableTask(client, input, expectedRevision)
      const values: TaskMutationValues = {
        updated_by: input.actorUserId,
        updated_at: taskNowIso(deps),
      }

      if (input.title !== undefined) {
        values.title = normalizeTaskTitle(input.title)
      }

      if (input.description !== undefined) {
        values.description = normalizeTaskDescription(input.description)
      }

      if (input.dueAt !== undefined) {
        values.due_at = normalizeTaskTimestamp(
          input.dueAt,
          "Task due date must be a valid timestamp."
        )
      }

      if (
        values.title === undefined &&
        values.description === undefined &&
        values.due_at === undefined
      ) {
        throw new TaskServiceError(
          "Provide at least one task field to update.",
          400
        )
      }

      const updatedTask = await applyTaskMutation(client, task, values)
      await recordTaskAuditLog(deps, {
        organizationId: updatedTask.organizationId,
        actorUserId: input.actorUserId,
        action: "task.updated",
        targetType: "task",
        targetId: updatedTask.id,
        metadata: {
          revision: updatedTask.revision,
          dueAt: updatedTask.dueAt,
        },
      })
      await syncAutomaticTaskReminder(
        client,
        deps,
        updatedTask,
        input.actorUserId
      )

      return updatedTask
    }
  )
}

/**
 * Assigns, reassigns, or clears the assignee of an open task.
 *
 * @param input - Actor, tenant, expected revision, and target assignee.
 * @param deps - Optional database, clock, audit, and publish dependencies.
 * @returns Updated task at its next revision.
 * @throws TaskServiceError when access, validation, state, or the write fails.
 */
export async function assignTask(
  input: AssignTaskInput,
  deps: TaskServiceDeps = {}
): Promise<Task> {
  return runTaskOperation(
    "assign_task",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      assignedTo: input.assignedTo,
    },
    async (): Promise<Task> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:assign",
        "You cannot assign tasks."
      )

      const expectedRevision = normalizeExpectedTaskRevision(
        input.expectedRevision
      )
      const assignedTo =
        input.assignedTo === null
          ? null
          : normalizeTaskUuid(
              input.assignedTo,
              "Task assignee must be a valid user id."
            )
      const task = await requireEditableTask(client, input, expectedRevision)

      if (assignedTo !== null) {
        await requireInternalTaskMember(
          client,
          input.organizationId,
          assignedTo,
          ASSIGNEE_REJECTION_MESSAGE
        )
      }

      const now = taskNowIso(deps)
      const updatedTask = await applyTaskMutation(client, task, {
        assigned_to: assignedTo,
        assigned_by: assignedTo === null ? null : input.actorUserId,
        assigned_at: assignedTo === null ? null : now,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      await recordTaskAuditLog(deps, {
        organizationId: updatedTask.organizationId,
        actorUserId: input.actorUserId,
        action: "task.assigned",
        targetType: "task",
        targetId: updatedTask.id,
        metadata: {
          assignedTo: updatedTask.assignedTo,
          previousAssignedTo: task.assignedTo,
        },
      })
      await syncAutomaticTaskReminder(
        client,
        deps,
        updatedTask,
        input.actorUserId
      )
      await publishTaskAssignment(deps, updatedTask, input.actorUserId)

      return updatedTask
    }
  )
}

/**
 * Applies one binding lifecycle change to a task.
 *
 * Only the transitions declared by the task state machine are accepted, and
 * completion timestamps are written by the service, never by the caller.
 *
 * @param input - Actor, tenant, expected revision, and target status.
 * @param deps - Optional database, clock, and audit dependencies.
 * @returns Updated task at its next revision.
 * @throws TaskServiceError when access, validation, state, or the write fails.
 */
export async function transitionTaskStatus(
  input: TransitionTaskStatusInput,
  deps: TaskServiceDeps = {}
): Promise<Task> {
  return runTaskOperation(
    "transition_task_status",
    {
      actorUserId: input.actorUserId,
      organizationId: input.organizationId,
      taskId: input.taskId,
      expectedRevision: input.expectedRevision,
      targetStatus: input.targetStatus,
    },
    async (): Promise<Task> => {
      const client = getTaskClient(deps)
      await requireTaskPermission(
        client,
        input.organizationId,
        input.actorUserId,
        "tasks:edit",
        "You cannot edit tasks."
      )

      const expectedRevision = normalizeExpectedTaskRevision(
        input.expectedRevision
      )
      const targetStatus = normalizeTaskStatus(input.targetStatus)
      const task = await getTaskById(
        client,
        input.organizationId,
        input.taskId
      )
      assertExpectedRevisionMatches(task, expectedRevision)

      if (!canTransitionTaskStatus(task.status, targetStatus)) {
        throw new TaskServiceError(
          `A ${task.status} task cannot move to ${targetStatus}.`,
          409
        )
      }

      const now = taskNowIso(deps)
      const updatedTask = await applyTaskMutation(client, task, {
        status: targetStatus,
        completed_at: targetStatus === "completed" ? now : null,
        updated_by: input.actorUserId,
        updated_at: now,
      })
      await recordTaskAuditLog(deps, {
        organizationId: updatedTask.organizationId,
        actorUserId: input.actorUserId,
        action: "task.status_changed",
        targetType: "task",
        targetId: updatedTask.id,
        metadata: {
          fromStatus: task.status,
          toStatus: updatedTask.status,
        },
      })
      await syncAutomaticTaskReminder(
        client,
        deps,
        updatedTask,
        input.actorUserId
      )

      return updatedTask
    }
  )
}

async function requireEditableTask(
  client: TaskServiceClient,
  input: GetTaskInput,
  expectedRevision: number
): Promise<Task> {
  const task = await getTaskById(client, input.organizationId, input.taskId)
  assertTaskIsOpenForChanges(task)
  assertExpectedRevisionMatches(task, expectedRevision)

  return task
}

function assertExpectedRevisionMatches(
  task: Task,
  expectedRevision: number
): void {
  if (task.revision !== expectedRevision) {
    throw new TaskServiceError(
      "Task changed since it was opened. Reload and try again.",
      409
    )
  }
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (
    typeof value !== "string" ||
    !TASK_STATUSES.includes(value as TaskStatus)
  ) {
    throw new TaskServiceError("Task status is not supported.", 400)
  }

  return value as TaskStatus
}

async function publishTaskAssignment(
  deps: TaskServiceDeps,
  task: Task,
  actorUserId: string
): Promise<void> {
  if (task.assignedTo === null || deps.publishTaskAssigned === undefined) {
    return
  }

  const event: TaskAssignedNotification = {
    organizationId: task.organizationId,
    taskId: task.id,
    assignedToUserId: task.assignedTo,
    assignedByUserId: actorUserId,
  }

  try {
    await deps.publishTaskAssigned(event)
  } catch (error: unknown) {
    console.warn("task_assigned_publish_failed", {
      organizationId: event.organizationId,
      taskId: event.taskId,
      reason: error instanceof Error ? error.message : "Unknown publish error",
    })
  }
}
