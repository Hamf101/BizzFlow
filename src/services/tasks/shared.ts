import { randomUUID } from "node:crypto"

import { ZodError } from "zod"

import { captureUnexpectedError } from "@/lib/observability"
import {
  canPerformOrganizationAction,
  isOrganizationRole,
  type OrganizationPermissionAction,
  type OrganizationRole,
} from "@/lib/permissions"
import { createAdminClient } from "@/lib/supabase/admin"
import { recordAuditLog as defaultRecordAuditLog } from "@/services/audit-service"
import type {
  TaskAuditLogInput,
  TaskLogValue,
  TaskServiceClient,
  TaskServiceDeps,
} from "@/services/tasks/contracts"
import { TaskServiceError } from "@/services/tasks/errors"
import {
  isTerminalTaskStatus,
  parseTaskReminderRow,
  parseTaskRow,
  TaskDomainError,
  TASK_STATUSES,
  type Task,
  type TaskReminder,
  type TaskStatus,
} from "@/types/task"

/** Columns required by the canonical task row parser. */
export const TASK_COLUMNS =
  "id,org_id,title,description,status,due_at,assigned_to,assigned_by,assigned_at,submission_id,created_by,updated_by,completed_at,revision,created_at,updated_at"

/** Columns required by the canonical task reminder row parser. */
export const TASK_REMINDER_COLUMNS =
  "id,org_id,task_id,recipient_user_id,remind_at,channel,origin,status,attempt_count,last_error,sent_at,created_by,created_at,updated_at"

/** Roles that may hold a task assignment or receive a task reminder. */
const INTERNAL_TASK_MEMBER_ROLES: readonly OrganizationRole[] = [
  "owner_admin",
  "manager",
  "staff",
]

const MAX_TASK_LIST_LIMIT = 200
const DEFAULT_TASK_LIST_LIMIT = 100
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Column values a task mutation may write. */
export type TaskMutationValues = {
  title?: string
  description?: string | null
  due_at?: string | null
  status?: TaskStatus
  completed_at?: string | null
  assigned_to?: string | null
  assigned_by?: string | null
  assigned_at?: string | null
  updated_by: string
  updated_at: string
}

type MembershipRoleRow = {
  role: string
}

type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

/**
 * Runs a task operation with contextual timing and safe error translation.
 *
 * @param operationName - Stable operation identifier for logs.
 * @param identifiers - Tenant, actor, and target identifiers.
 * @param operation - Asynchronous service operation.
 * @returns The operation result.
 * @throws TaskServiceError for every expected or unexpected failure.
 */
export async function runTaskOperation<T>(
  operationName: string,
  identifiers: Record<string, TaskLogValue>,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()

  try {
    const result = await operation()
    console.info("task_service_success", {
      operationName,
      durationMs: Date.now() - startedAt,
      ...identifiers,
    })
    return result
  } catch (error: unknown) {
    const serviceError = toTaskServiceError(error)
    const log = serviceError.statusCode >= 500 ? console.error : console.warn
    log(
      serviceError.statusCode >= 500
        ? "task_service_failed"
        : "task_service_rejected",
      {
        operationName,
        durationMs: Date.now() - startedAt,
        statusCode: serviceError.statusCode,
        reason: serviceError.message,
        ...identifiers,
      }
    )

    if (serviceError.statusCode >= 500) {
      captureUnexpectedError(error, { operationName, ...identifiers })
    }

    throw serviceError
  }
}

/**
 * Resolves the injected trusted Supabase client or creates the production client.
 *
 * @param deps - Optional task service dependencies.
 * @returns Trusted database client.
 */
export function getTaskClient(deps: TaskServiceDeps): TaskServiceClient {
  return deps.client ?? createAdminClient()
}

/**
 * Creates a UUID using an injected generator when provided.
 *
 * @param deps - Optional task service dependencies.
 * @returns New task or reminder identifier.
 */
export function createTaskId(deps: TaskServiceDeps): string {
  return deps.createId?.() ?? randomUUID()
}

/**
 * Reads the current instant from the injected clock.
 *
 * @param deps - Optional task service dependencies.
 * @returns Current instant.
 */
export function taskNow(deps: TaskServiceDeps): Date {
  return deps.now?.() ?? new Date()
}

/**
 * Reads the current instant from the injected clock as an ISO timestamp.
 *
 * @param deps - Optional task service dependencies.
 * @returns Current instant in ISO-8601 form.
 */
export function taskNowIso(deps: TaskServiceDeps): string {
  return taskNow(deps).toISOString()
}

/**
 * Requires an active organization membership with the requested permission.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param actorUserId - Requesting user identifier.
 * @param action - Required permission action.
 * @param rejectionMessage - User-safe access rejection.
 * @returns Validated active organization role.
 * @throws TaskServiceError when membership is absent or the action is denied.
 */
export async function requireTaskPermission(
  client: TaskServiceClient,
  organizationId: string,
  actorUserId: string,
  action: OrganizationPermissionAction,
  rejectionMessage: string
): Promise<OrganizationRole> {
  const role = await loadActiveMembershipRole(
    client,
    organizationId,
    actorUserId
  )

  if (!role || !canPerformOrganizationAction(role, action)) {
    throw new TaskServiceError(rejectionMessage, 403)
  }

  return role
}

/**
 * Reads the active organization role of a member, if one exists.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param userId - Member identifier.
 * @returns Active role, or null when the member has none.
 * @throws TaskServiceError when the membership query fails or returns junk.
 */
export async function loadActiveMembershipRole(
  client: TaskServiceClient,
  organizationId: string,
  userId: string
): Promise<OrganizationRole | null> {
  const { data, error } = await client
    .from("organization_memberships")
    .select("role")
    .eq("org_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load task permissions.")
  }

  const role = (data as MembershipRoleRow | null)?.role

  if (role === undefined) {
    return null
  }

  if (!isOrganizationRole(role)) {
    throw new TaskServiceError(
      "Database returned an unsupported organization role.",
      500
    )
  }

  return role
}

/**
 * Requires a user to be an active internal member of the tenant.
 *
 * External reviewers are outside contributors, so they can never hold a task
 * assignment or receive a task reminder.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param userId - Candidate assignee or reminder recipient.
 * @param rejectionMessage - User-safe rejection description.
 * @throws TaskServiceError when the user is not an eligible internal member.
 */
export async function requireInternalTaskMember(
  client: TaskServiceClient,
  organizationId: string,
  userId: string,
  rejectionMessage: string
): Promise<void> {
  const role = await loadActiveMembershipRole(client, organizationId, userId)

  if (!role || !INTERNAL_TASK_MEMBER_ROLES.includes(role)) {
    throw new TaskServiceError(rejectionMessage, 400)
  }
}

/**
 * Loads a tenant-scoped task.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param taskId - Task identifier.
 * @returns Parsed task.
 * @throws TaskServiceError when the row is absent or invalid.
 */
export async function getTaskById(
  client: TaskServiceClient,
  organizationId: string,
  taskId: string
): Promise<Task> {
  const { data, error } = await client
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load task.")
  }

  if (!data) {
    throw new TaskServiceError("Task was not found.", 404)
  }

  return parseTaskRow(data)
}

/**
 * Loads every reminder scheduled against one tenant-scoped task.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param taskId - Task identifier.
 * @returns Reminders ordered by their scheduled instant.
 * @throws TaskServiceError when the query fails or a row is invalid.
 */
export async function listTaskReminderRows(
  client: TaskServiceClient,
  organizationId: string,
  taskId: string
): Promise<TaskReminder[]> {
  const { data, error } = await client
    .from("task_reminders")
    .select(TASK_REMINDER_COLUMNS)
    .eq("org_id", organizationId)
    .eq("task_id", taskId)
    .order("remind_at", { ascending: true })

  if (error || !data) {
    throw createTaskDatabaseError(error, "Unable to load task reminders.")
  }

  return data.map(parseTaskReminderRow)
}

/**
 * Applies one guarded task mutation using optimistic concurrency.
 *
 * The update matches on the tenant, revision, and observed status, so a
 * concurrent writer can never be silently overwritten.
 *
 * @param client - Trusted Supabase client.
 * @param task - Task as it was read by the operation.
 * @param values - Column values to write.
 * @returns Updated task at its next revision.
 * @throws TaskServiceError when the write fails or the task moved on.
 */
export async function applyTaskMutation(
  client: TaskServiceClient,
  task: Task,
  values: TaskMutationValues
): Promise<Task> {
  const { data, error } = await client
    .from("tasks")
    .update({ ...values, revision: task.revision + 1 })
    .eq("id", task.id)
    .eq("org_id", task.organizationId)
    .eq("revision", task.revision)
    .eq("status", task.status)
    .select(TASK_COLUMNS)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to update task.")
  }

  if (!data) {
    throw new TaskServiceError(
      "Task changed since it was opened. Reload and try again.",
      409
    )
  }

  return parseTaskRow(data)
}

/**
 * Requires a tenant submission to exist before a task links to it.
 *
 * @param client - Trusted Supabase client.
 * @param organizationId - Tenant identifier.
 * @param submissionId - Originating submission identifier.
 * @throws TaskServiceError when the submission is outside the tenant.
 */
export async function requireTenantSubmission(
  client: TaskServiceClient,
  organizationId: string,
  submissionId: string
): Promise<void> {
  const { data, error } = await client
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .eq("org_id", organizationId)
    .maybeSingle()

  if (error) {
    throw createTaskDatabaseError(error, "Unable to load the linked submission.")
  }

  if (!data) {
    throw new TaskServiceError("Linked submission was not found.", 404)
  }
}

/**
 * Rejects mutations against a task that already reached a terminal status.
 *
 * @param task - Task as it was read by the operation.
 * @throws TaskServiceError when the task is completed or cancelled.
 */
export function assertTaskIsOpenForChanges(task: Task): void {
  if (isTerminalTaskStatus(task.status)) {
    throw new TaskServiceError(
      "Completed and cancelled tasks can no longer be changed.",
      409
    )
  }
}

/**
 * Validates a client-supplied revision before an optimistic update.
 *
 * @param value - Untrusted expected revision.
 * @returns Validated positive revision.
 * @throws TaskServiceError when the value is not a positive integer.
 */
export function normalizeExpectedTaskRevision(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TaskServiceError(
      "Expected task revision must be a positive integer.",
      400
    )
  }

  return value
}

/**
 * Normalizes an untrusted task title to the persisted contract.
 *
 * @param value - Untrusted title.
 * @returns Trimmed single-spaced title.
 * @throws TaskServiceError when the title is empty or too long.
 */
export function normalizeTaskTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new TaskServiceError("Task title must be text.", 400)
  }

  const title = value.trim().replace(/\s+/g, " ")

  if (title.length < 1 || title.length > 200) {
    throw new TaskServiceError(
      "Task title must be between 1 and 200 characters.",
      400
    )
  }

  return title
}

/**
 * Normalizes an untrusted task description to the persisted contract.
 *
 * @param value - Untrusted description.
 * @returns Trimmed description, or null when empty.
 * @throws TaskServiceError when the description is not text or too long.
 */
export function normalizeTaskDescription(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== "string") {
    throw new TaskServiceError("Task description must be text.", 400)
  }

  const description = value.trim()

  if (description.length === 0) {
    return null
  }

  if (description.length > 5_000) {
    throw new TaskServiceError(
      "Task description cannot exceed 5,000 characters.",
      400
    )
  }

  return description
}

/**
 * Normalizes an untrusted timestamp into a canonical ISO instant.
 *
 * @param value - Untrusted timestamp.
 * @param message - User-safe rejection description.
 * @returns Canonical ISO timestamp, or null when unset.
 * @throws TaskServiceError when the value is not a usable timestamp.
 */
export function normalizeTaskTimestamp(
  value: unknown,
  message: string
): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  if (typeof value !== "string") {
    throw new TaskServiceError(message, 400)
  }

  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    throw new TaskServiceError(message, 400)
  }

  return timestamp.toISOString()
}

/**
 * Normalizes an untrusted identifier into a canonical UUID.
 *
 * @param value - Untrusted identifier.
 * @param message - User-safe rejection description.
 * @returns Canonical lowercase UUID.
 * @throws TaskServiceError when the value is not a UUID.
 */
export function normalizeTaskUuid(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new TaskServiceError(message, 400)
  }

  const normalizedValue = value.trim().toLowerCase()

  if (!UUID_PATTERN.test(normalizedValue)) {
    throw new TaskServiceError(message, 400)
  }

  return normalizedValue
}

/**
 * Normalizes an optional untrusted identifier into a canonical UUID.
 *
 * @param value - Untrusted identifier.
 * @param message - User-safe rejection description.
 * @returns Canonical lowercase UUID, or null when unset.
 * @throws TaskServiceError when a supplied value is not a UUID.
 */
export function normalizeOptionalTaskUuid(
  value: unknown,
  message: string
): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : normalizeTaskUuid(value, message)
}

/**
 * Validates an untrusted status filter against the task state machine.
 *
 * @param value - Untrusted statuses.
 * @returns Distinct validated statuses, or null when unfiltered.
 * @throws TaskServiceError when a status is not supported.
 */
export function normalizeTaskStatusFilter(
  value: readonly string[] | undefined
): TaskStatus[] | null {
  if (value === undefined) {
    return null
  }

  const statuses = Array.from(new Set(value))

  if (statuses.length === 0) {
    return null
  }

  statuses.forEach((status: string): void => {
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      throw new TaskServiceError("Task status filter is not supported.", 400)
    }
  })

  return statuses as TaskStatus[]
}

/**
 * Validates and bounds an untrusted task list limit.
 *
 * @param value - Untrusted limit.
 * @returns Bounded page size.
 * @throws TaskServiceError when the limit is outside the supported range.
 */
export function normalizeTaskListLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TASK_LIST_LIMIT
  }

  if (!Number.isInteger(value) || value < 1 || value > MAX_TASK_LIST_LIMIT) {
    throw new TaskServiceError(
      `Task list limit must be between 1 and ${MAX_TASK_LIST_LIMIT}.`,
      400
    )
  }

  return value
}

/**
 * Records a best-effort task audit event without failing the operation.
 *
 * @param deps - Injected task service dependencies.
 * @param input - Audit event payload.
 */
export async function recordTaskAuditLog(
  deps: TaskServiceDeps,
  input: TaskAuditLogInput
): Promise<void> {
  const recordAuditLog = deps.recordAuditLog ?? defaultRecordAuditLog

  try {
    await recordAuditLog(input)
  } catch (error: unknown) {
    console.warn("task_audit_log_failed", {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetId: input.targetId,
      reason: error instanceof Error ? error.message : "Unknown audit error",
    })
  }
}

/**
 * Converts a Supabase query failure into a safe task service error.
 *
 * @param error - Supabase or setup error.
 * @param fallbackMessage - Safe message for unexpected database failures.
 * @returns Task service error.
 */
export function createTaskDatabaseError(
  error: unknown,
  fallbackMessage: string
): TaskServiceError {
  const errorLike = asSupabaseError(error)
  const searchableMessage = [
    errorLike?.code,
    errorLike?.message,
    errorLike?.details,
    errorLike?.hint,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  if (errorLike?.code === "23505") {
    return new TaskServiceError("A conflicting task record already exists.", 409)
  }

  if (errorLike?.code === "23514" || errorLike?.code === "22P02") {
    return new TaskServiceError("Task data failed validation.", 400)
  }

  if (
    errorLike?.code === "42P01" ||
    searchableMessage.includes("could not find the table") ||
    searchableMessage.includes("schema cache")
  ) {
    return new TaskServiceError(
      "Tasks are not installed. Apply the latest Supabase migrations.",
      500
    )
  }

  return new TaskServiceError(fallbackMessage, 500)
}

function toTaskServiceError(error: unknown): TaskServiceError {
  if (error instanceof TaskServiceError) {
    return error
  }

  if (error instanceof TaskDomainError) {
    return new TaskServiceError(error.message, error.statusCode)
  }

  if (error instanceof ZodError) {
    return new TaskServiceError("Task data is invalid.", 400)
  }

  if (
    error instanceof Error &&
    error.message.includes("Invalid admin Supabase environment")
  ) {
    return new TaskServiceError(
      "Supabase server credentials are not configured.",
      500
    )
  }

  return new TaskServiceError("Task service failed.", 500)
}

function asSupabaseError(error: unknown): SupabaseErrorLike | null {
  return error && typeof error === "object"
    ? (error as SupabaseErrorLike)
    : null
}
