import { describe, expect, it } from "vitest"

import {
  canTransitionTaskStatus,
  isTerminalTaskStatus,
  parseTaskReminderRow,
  parseTaskRow,
  TASK_STATUSES,
  TaskDomainError,
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
  it("lets work move forward but never back to open, and a finished task nowhere", () => {
    const moves = TASK_STATUSES.flatMap((from) => TASK_STATUSES.filter((to) => canTransitionTaskStatus(from, to)).map((to) => `${from}→${to}`))

    expect(moves).toEqual(["open→in_progress", "open→completed", "open→cancelled", "in_progress→completed", "in_progress→cancelled"])
    expect(TASK_STATUSES.filter(isTerminalTaskStatus)).toEqual(["completed", "cancelled"])
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

  it("keeps a task and its reminder whose creator's account was deleted", () => {
    const task = parseTaskRow({ ...OPEN_TASK_ROW, created_by: null, updated_by: null })
    const reminder = parseTaskReminderRow({ ...PENDING_REMINDER_ROW, created_by: null })

    expect([task.createdBy, task.updatedBy, reminder.createdBy]).toEqual([null, null, null])
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
    { row: { ...OPEN_TASK_ROW, created_by: "someone" }, reason: "non-uuid author" },
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
      origin: "manual",
      status: "pending",
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      createdBy: USER_ID,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    })
  })

  it.each([
    {
      row: { ...PENDING_REMINDER_ROW, status: "queued" },
      reason: "unknown status",
    },
    {
      row: { ...PENDING_REMINDER_ROW, channel: "push" },
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
})
