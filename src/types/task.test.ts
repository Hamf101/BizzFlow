import { describe, expect, it } from "vitest"

import {
  canTransitionTaskStatus,
  isTerminalTaskStatus,
  parseTaskReminderRow,
  parseTaskRow,
  TASK_REMINDER_CHANNELS,
  TASK_REMINDER_STATUSES,
  TASK_STATUS_TRANSITIONS,
  TASK_STATUSES,
  TaskDomainError,
  taskReminderSchema,
  taskReminderStatusSchema,
  taskSchema,
  taskStatusSchema,
  type TaskStatus,
} from "@/types/task"

const TASK_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "30000000-0000-4000-8000-000000000001"
const USER_ID = "40000000-0000-4000-8000-000000000001"
const ASSIGNEE_ID = "50000000-0000-4000-8000-000000000001"
const ASSIGNER_ID = "60000000-0000-4000-8000-000000000001"
const REMINDER_ID = "70000000-0000-4000-8000-000000000001"
const CREATED_AT = "2026-07-30T09:00:00.000Z"
const UPDATED_AT = "2026-07-30T10:00:00.000Z"
const DUE_AT = "2026-08-05T17:00:00.000Z"
const ASSIGNED_AT = "2026-07-30T09:30:00.000Z"
const COMPLETED_AT = "2026-07-31T12:00:00.000Z"
const REMIND_AT = "2026-08-04T09:00:00.000Z"
const SENT_AT = "2026-08-04T09:01:00.000Z"

const OPEN_TASK_ROW = {
  id: TASK_ID,
  org_id: ORGANIZATION_ID,
  title: "Collect insurance certificate",
  description: "Chase the vendor for the renewed certificate.",
  status: "open",
  due_at: DUE_AT,
  assigned_to: null,
  assigned_by: null,
  assigned_at: null,
  submission_id: SUBMISSION_ID,
  created_by: USER_ID,
  updated_by: USER_ID,
  completed_at: null,
  revision: 1,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
}

const ASSIGNED_ROW_METADATA = {
  assigned_to: ASSIGNEE_ID,
  assigned_by: ASSIGNER_ID,
  assigned_at: ASSIGNED_AT,
}

const PENDING_REMINDER_ROW = {
  id: REMINDER_ID,
  org_id: ORGANIZATION_ID,
  task_id: TASK_ID,
  recipient_user_id: ASSIGNEE_ID,
  remind_at: REMIND_AT,
  channel: "email",
  status: "pending",
  attempt_count: 0,
  last_error: null,
  sent_at: null,
  created_by: USER_ID,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
}

describe("task status contract", () => {
  it("exposes the lifecycle vocabularies as shared const arrays", () => {
    expect(TASK_STATUSES).toEqual([
      "open",
      "in_progress",
      "completed",
      "cancelled",
    ])
    expect(TASK_REMINDER_STATUSES).toEqual([
      "pending",
      "sent",
      "failed",
      "cancelled",
    ])
    expect(TASK_REMINDER_CHANNELS).toEqual(["email"])
    expect(taskStatusSchema.options).toEqual([...TASK_STATUSES])
    expect(taskReminderStatusSchema.safeParse("queued").success).toBe(false)
  })

  it.each([
    { from: "open", to: "in_progress", allowed: true },
    { from: "open", to: "completed", allowed: true },
    { from: "open", to: "cancelled", allowed: true },
    { from: "open", to: "open", allowed: false },
    { from: "in_progress", to: "completed", allowed: true },
    { from: "in_progress", to: "cancelled", allowed: true },
    { from: "in_progress", to: "open", allowed: false },
    { from: "in_progress", to: "in_progress", allowed: false },
    { from: "completed", to: "open", allowed: false },
    { from: "completed", to: "in_progress", allowed: false },
    { from: "completed", to: "cancelled", allowed: false },
    { from: "completed", to: "completed", allowed: false },
    { from: "cancelled", to: "open", allowed: false },
    { from: "cancelled", to: "in_progress", allowed: false },
    { from: "cancelled", to: "completed", allowed: false },
    { from: "cancelled", to: "cancelled", allowed: false },
  ] as const satisfies ReadonlyArray<{
    from: TaskStatus
    to: TaskStatus
    allowed: boolean
  }>)("allows $from → $to: $allowed", ({ from, to, allowed }) => {
    expect(canTransitionTaskStatus(from, to)).toBe(allowed)
    expect(TASK_STATUS_TRANSITIONS[from].includes(to)).toBe(allowed)
  })

  it("covers every status in the transition table and marks terminal states", () => {
    expect(Object.keys(TASK_STATUS_TRANSITIONS).sort()).toEqual(
      [...TASK_STATUSES].sort()
    )
    expect(TASK_STATUSES.filter(isTerminalTaskStatus)).toEqual([
      "completed",
      "cancelled",
    ])
  })
})

describe("task persistence types", () => {
  it("parses and maps an unassigned open task row", () => {
    const task = parseTaskRow({
      ...OPEN_TASK_ROW,
      ignored_rpc_metadata: "forward-compatible",
    })

    expect(task).toEqual({
      id: TASK_ID,
      organizationId: ORGANIZATION_ID,
      title: "Collect insurance certificate",
      description: "Chase the vendor for the renewed certificate.",
      status: "open",
      dueAt: DUE_AT,
      assignedTo: null,
      assignedBy: null,
      assignedAt: null,
      submissionId: SUBMISSION_ID,
      createdBy: USER_ID,
      updatedBy: USER_ID,
      completedAt: null,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    })
  })

  it("parses a standalone task without optional associations", () => {
    const task = parseTaskRow({
      ...OPEN_TASK_ROW,
      description: null,
      due_at: null,
      submission_id: null,
    })

    expect(task.description).toBeNull()
    expect(task.dueAt).toBeNull()
    expect(task.submissionId).toBeNull()
  })

  it.each(["open", "in_progress", "cancelled"] as const)(
    "preserves assignment metadata for a %s task",
    (status) => {
      const task = parseTaskRow({
        ...OPEN_TASK_ROW,
        ...ASSIGNED_ROW_METADATA,
        status,
      })

      expect(task.status).toBe(status)
      expect(task.completedAt).toBeNull()
      expect(task.assignedTo).toBe(ASSIGNEE_ID)
      expect(task.assignedBy).toBe(ASSIGNER_ID)
      expect(task.assignedAt).toBe(ASSIGNED_AT)
    }
  )

  it("parses a completed task with and without assignment metadata", () => {
    const unassigned = parseTaskRow({
      ...OPEN_TASK_ROW,
      status: "completed",
      completed_at: COMPLETED_AT,
    })
    const assigned = parseTaskRow({
      ...OPEN_TASK_ROW,
      ...ASSIGNED_ROW_METADATA,
      status: "completed",
      completed_at: COMPLETED_AT,
      revision: 4,
    })

    expect(unassigned.status).toBe("completed")
    expect(unassigned.completedAt).toBe(COMPLETED_AT)
    expect(unassigned.assignedTo).toBeNull()
    expect(assigned.completedAt).toBe(COMPLETED_AT)
    expect(assigned.assignedTo).toBe(ASSIGNEE_ID)
    expect(assigned.revision).toBe(4)
  })

  it.each([
    { row: { ...OPEN_TASK_ROW, status: "archived" }, reason: "unknown status" },
    {
      row: { ...OPEN_TASK_ROW, status: "completed" },
      reason: "completed task without a completion timestamp",
    },
    {
      row: { ...OPEN_TASK_ROW, completed_at: COMPLETED_AT },
      reason: "open task with a completion timestamp",
    },
    {
      row: { ...OPEN_TASK_ROW, assigned_to: ASSIGNEE_ID },
      reason: "partial assignment triple",
    },
    {
      row: {
        ...OPEN_TASK_ROW,
        assigned_to: ASSIGNEE_ID,
        assigned_by: ASSIGNER_ID,
      },
      reason: "assignment without a timestamp",
    },
    {
      row: { ...OPEN_TASK_ROW, ...ASSIGNED_ROW_METADATA, assigned_to: null },
      reason: "assignment timestamp without an assignee",
    },
    { row: { ...OPEN_TASK_ROW, title: "" }, reason: "empty title" },
    {
      row: { ...OPEN_TASK_ROW, title: "t".repeat(201) },
      reason: "title over the column limit",
    },
    {
      row: { ...OPEN_TASK_ROW, description: "d".repeat(5_001) },
      reason: "description over the column limit",
    },
    { row: { ...OPEN_TASK_ROW, revision: 0 }, reason: "non-positive revision" },
    { row: { ...OPEN_TASK_ROW, created_by: null }, reason: "missing author" },
    { row: { ...OPEN_TASK_ROW, org_id: "org-1" }, reason: "non-uuid tenant" },
    {
      row: { ...OPEN_TASK_ROW, due_at: "2026-08-05" },
      reason: "date-only due timestamp",
    },
  ])("rejects an invalid task row: $reason", ({ row }) => {
    expect(() => parseTaskRow(row)).toThrowError(
      expect.objectContaining<Partial<TaskDomainError>>({
        code: "invalid_task_row",
        statusCode: 500,
      })
    )
  })

  it("parses and maps a pending reminder row", () => {
    const reminder = parseTaskReminderRow({
      ...PENDING_REMINDER_ROW,
      ignored_rpc_metadata: "forward-compatible",
    })

    expect(reminder).toEqual({
      id: REMINDER_ID,
      organizationId: ORGANIZATION_ID,
      taskId: TASK_ID,
      recipientUserId: ASSIGNEE_ID,
      remindAt: REMIND_AT,
      channel: "email",
      status: "pending",
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      createdBy: USER_ID,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    })
  })

  it("parses a sent reminder and a failed reminder with a safe reason", () => {
    const sent = parseTaskReminderRow({
      ...PENDING_REMINDER_ROW,
      status: "sent",
      attempt_count: 1,
      sent_at: SENT_AT,
    })
    const failed = parseTaskReminderRow({
      ...PENDING_REMINDER_ROW,
      status: "failed",
      attempt_count: 3,
      last_error: "Recipient mailbox rejected the message.",
    })

    expect(sent.status).toBe("sent")
    expect(sent.sentAt).toBe(SENT_AT)
    expect(sent.attemptCount).toBe(1)
    expect(failed.status).toBe("failed")
    expect(failed.sentAt).toBeNull()
    expect(failed.lastError).toBe("Recipient mailbox rejected the message.")
  })

  it("parses a cancelled reminder", () => {
    const cancelled = parseTaskReminderRow({
      ...PENDING_REMINDER_ROW,
      status: "cancelled",
    })

    expect(cancelled.status).toBe("cancelled")
    expect(cancelled.sentAt).toBeNull()
  })

  it.each([
    {
      row: { ...PENDING_REMINDER_ROW, status: "queued" },
      reason: "unknown status",
    },
    {
      row: { ...PENDING_REMINDER_ROW, channel: "sms" },
      reason: "unsupported channel",
    },
    {
      row: { ...PENDING_REMINDER_ROW, status: "sent" },
      reason: "sent reminder without a send timestamp",
    },
    {
      row: { ...PENDING_REMINDER_ROW, sent_at: SENT_AT },
      reason: "pending reminder with a send timestamp",
    },
    {
      row: { ...PENDING_REMINDER_ROW, attempt_count: -1 },
      reason: "negative attempt count",
    },
    {
      row: { ...PENDING_REMINDER_ROW, last_error: "e".repeat(501) },
      reason: "error reason over the column limit",
    },
    {
      row: { ...PENDING_REMINDER_ROW, remind_at: null },
      reason: "missing reminder timestamp",
    },
    {
      row: { ...PENDING_REMINDER_ROW, recipient_user_id: null },
      reason: "missing recipient",
    },
    {
      row: { ...PENDING_REMINDER_ROW, task_id: "task-1" },
      reason: "non-uuid task reference",
    },
  ])("rejects an invalid task reminder row: $reason", ({ row }) => {
    expect(() => parseTaskReminderRow(row)).toThrowError(
      expect.objectContaining<Partial<TaskDomainError>>({
        code: "invalid_task_reminder_row",
        statusCode: 500,
      })
    )
  })

  it("exposes row schemas that accept valid rows without throwing", () => {
    expect(taskSchema.safeParse(OPEN_TASK_ROW).success).toBe(true)
    expect(taskReminderSchema.safeParse(PENDING_REMINDER_ROW).success).toBe(true)
  })
})
