import { describe, expect, it, vi } from "vitest"

import {
  cancelTaskReminder,
  listTaskReminders,
  notifyTaskAssignee,
  processDueTaskReminders,
  scheduleTaskReminder,
  TASK_REMINDER_BATCH_LIMIT,
  TASK_REMINDER_MAX_ATTEMPTS,
  TaskServiceError,
} from "@/services/task-service"
import {
  createDeps,
  createMembershipRow,
  createMembershipRows,
  createProfileRow,
  createTaskRow,
  createTaskReminderRow,
  FakeSupabaseClient,
  CREATED_AT,
  FUTURE_AT,
  MANAGER_ID,
  NEW_REMINDER_ID,
  NOW,
  ORG_ID,
  PAST_AT,
  REMINDER_ID,
  REVIEWER_ID,
  STAFF_ID,
  TASK_ID,
} from "@/services/task-service.test-support"

const LATER_AT = "2026-07-31T15:00:00.000Z"
const SECOND_REMINDER_ID = "50000000-0000-4000-8000-000000000002"
const MISSING_TASK_ID = "30000000-0000-4000-8000-0000000000ff"

type FakeRow = Record<string, unknown>

function createReminderClient(
  reminders: FakeRow[] = [],
  tasks: FakeRow[] = [createTaskRow()]
): FakeSupabaseClient {
  return new FakeSupabaseClient({
    organization_memberships: createMembershipRows(),
    profiles: [createProfileRow()],
    tasks,
    task_reminders: reminders,
  })
}

describe("scheduleTaskReminder", () => {
  it("creates a pending reminder and records the audit event", async () => {
    const client = createReminderClient()
    const deps = createDeps(client, [NEW_REMINDER_ID])

    const reminder = await scheduleTaskReminder(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        recipientUserId: STAFF_ID,
        remindAt: FUTURE_AT,
      },
      deps
    )

    expect(reminder).toMatchObject({
      id: NEW_REMINDER_ID,
      organizationId: ORG_ID,
      taskId: TASK_ID,
      recipientUserId: STAFF_ID,
      remindAt: FUTURE_AT,
      channel: "email",
      status: "pending",
      attemptCount: 0,
      lastError: null,
      sentAt: null,
      createdBy: MANAGER_ID,
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task_reminder.scheduled",
        targetType: "task_reminder",
        targetId: NEW_REMINDER_ID,
      })
    )
  })

  it("rejects a duplicate reminder for the same recipient and instant", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ remind_at: FUTURE_AT }),
    ])

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: STAFF_ID,
          remindAt: FUTURE_AT,
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(client.tables.task_reminders).toHaveLength(1)
  })

  it.each([
    ["an instant in the past", PAST_AT],
    ["the current instant", NOW],
  ])("rejects %s", async (_label: string, remindAt: string) => {
    const client = createReminderClient()

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: STAFF_ID,
          remindAt,
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an unparsable reminder instant", async () => {
    const client = createReminderClient()

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: STAFF_ID,
          remindAt: "tomorrow morning",
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an external reviewer as the recipient", async () => {
    const client = createReminderClient()

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: REVIEWER_ID,
          remindAt: FUTURE_AT,
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects scheduling against a completed task", async () => {
    const client = createReminderClient(
      [],
      [createTaskRow({ status: "completed", completed_at: CREATED_AT })]
    )

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: STAFF_ID,
          remindAt: FUTURE_AT,
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("rejects an external reviewer scheduling reminders", async () => {
    const client = createReminderClient()

    await expect(
      scheduleTaskReminder(
        {
          actorUserId: REVIEWER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          recipientUserId: STAFF_ID,
          remindAt: FUTURE_AT,
        },
        createDeps(client, [NEW_REMINDER_ID])
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("cancelTaskReminder", () => {
  it("cancels a pending reminder without deleting the row", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ remind_at: FUTURE_AT }),
    ])
    const deps = createDeps(client)

    const reminder = await cancelTaskReminder(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        reminderId: REMINDER_ID,
      },
      deps
    )

    expect(reminder.status).toBe("cancelled")
    expect(client.tables.task_reminders).toHaveLength(1)
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task_reminder.cancelled" })
    )
  })

  it.each(["sent", "failed", "cancelled"])(
    "refuses to cancel a %s reminder",
    async (status: string) => {
      const client = createReminderClient([
        createTaskReminderRow({
          status,
          sent_at: status === "sent" ? CREATED_AT : null,
        }),
      ])

      await expect(
        cancelTaskReminder(
          {
            actorUserId: MANAGER_ID,
            organizationId: ORG_ID,
            taskId: TASK_ID,
            reminderId: REMINDER_ID,
          },
          createDeps(client)
        )
      ).rejects.toMatchObject({ statusCode: 409 })
    }
  )

  it("reports a missing reminder as not found", async () => {
    const client = createReminderClient()

    await expect(
      cancelTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          reminderId: REMINDER_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("rejects a concurrent cancel that already claimed the reminder", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    client.onNextUpdate("task_reminders", (): void => {
      client.tables.task_reminders[0].status = "cancelled"
    })

    await expect(
      cancelTaskReminder(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          reminderId: REMINDER_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe("listTaskReminders", () => {
  it("returns reminders ordered by their scheduled instant", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ id: SECOND_REMINDER_ID, remind_at: LATER_AT }),
      createTaskReminderRow({ remind_at: FUTURE_AT }),
    ])

    const reminders = await listTaskReminders(
      { actorUserId: STAFF_ID, organizationId: ORG_ID, taskId: TASK_ID },
      createDeps(client)
    )

    expect(reminders.map((reminder): string => reminder.id)).toEqual([
      REMINDER_ID,
      SECOND_REMINDER_ID,
    ])
  })

  it("rejects an external reviewer", async () => {
    const client = createReminderClient([createTaskReminderRow()])

    await expect(
      listTaskReminders(
        { actorUserId: REVIEWER_ID, organizationId: ORG_ID, taskId: TASK_ID },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("processDueTaskReminders", () => {
  it("sends a due reminder once and marks it sent with an attempt recorded", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toEqual({
      scannedCount: 1,
      sentCount: 1,
      failedCount: 0,
      retryingCount: 0,
      skippedCount: 0,
    })
    expect(deps.sendTaskEmail).toHaveBeenCalledWith({
      kind: "reminder",
      deliveryReference: `task-reminder/${REMINDER_ID}`,
      taskId: TASK_ID,
      taskTitle: "Collect signed lease",
      dueAt: FUTURE_AT,
      recipientEmail: "staff@example.com",
      recipientName: "Sam Staff",
    })
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "sent",
      sent_at: NOW,
      attempt_count: 1,
      last_error: null,
    })
  })

  it("leaves reminders that are not yet due or no longer pending untouched", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ remind_at: FUTURE_AT }),
      createTaskReminderRow({ id: SECOND_REMINDER_ID, status: "cancelled" }),
    ])
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary.scannedCount).toBe(0)
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
  })

  it("is idempotent across replayed runs", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)

    const firstSummary = await processDueTaskReminders(deps)
    const secondSummary = await processDueTaskReminders(deps)

    expect(firstSummary.sentCount).toBe(1)
    expect(secondSummary).toEqual({
      scannedCount: 0,
      sentCount: 0,
      failedCount: 0,
      retryingCount: 0,
      skippedCount: 0,
    })
    expect(deps.sendTaskEmail).toHaveBeenCalledTimes(1)
    expect(client.tables.task_reminders[0].attempt_count).toBe(1)
  })

  it("cancels an email reminder the member has switched off", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    client.tables.organization_memberships[2].email_notifications_enabled = false
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    // A suppressed reminder was never handed to a provider, so counting it as
    // sent would make the delivery history claim something that never happened.
    expect(summary).toMatchObject({ sentCount: 0, skippedCount: 1 })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "cancelled",
      last_error: null,
    })
    expect(deps.recordNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "email", status: "suppressed" })
    )
  })

  it("cancels an sms reminder the member has switched off", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ channel: "sms" }),
    ])
    client.tables.organization_memberships[2].sms_notifications_enabled = false
    client.tables.profiles[0].phone_number = "+14155552671"
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ sentCount: 0, skippedCount: 1 })
    expect(deps.sendSms).not.toHaveBeenCalled()
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "cancelled",
      last_error: null,
    })
  })

  it("suppresses delivery when the organization disabled the channel", async () => {
    // An organization switch must win over an individual preference.
    const client = createReminderClient([createTaskReminderRow()])
    client.tables.organizations[0].email_notifications_enabled = false
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ sentCount: 0, skippedCount: 1 })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
  })

  it("retries and records an sms the provider refused", async () => {
    // Providers report failure by RETURNING success:false rather than throwing.
    const client = createReminderClient([
      createTaskReminderRow({ channel: "sms" }),
    ])
    client.tables.profiles[0].phone_number = "+14155552671"
    const deps = createDeps(client)
    vi.mocked(deps.sendSms).mockResolvedValue({
      success: false,
      error: "Provider rejected the destination.",
    })

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ retryingCount: 1, sentCount: 0 })
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "pending",
      last_error: "Provider rejected the destination.",
    })
    expect(deps.recordNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "sms", status: "failed" })
    )
  })

  it("records a successful sms send", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ channel: "sms" }),
    ])
    client.tables.profiles[0].phone_number = "+14155552671"
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ sentCount: 1 })
    expect(deps.sendSms).toHaveBeenCalledTimes(1)
    expect(client.tables.task_reminders[0]).toMatchObject({ status: "sent" })
  })

  it("skips a reminder a concurrent run claimed first", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)
    client.onNextUpdate("task_reminders", (): void => {
      client.tables.task_reminders[0].attempt_count = 1
    })

    const summary = await processDueTaskReminders(deps)

    expect(summary).toEqual({
      scannedCount: 1,
      sentCount: 0,
      failedCount: 0,
      retryingCount: 0,
      skippedCount: 1,
    })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
    expect(client.tables.task_reminders[0].status).toBe("pending")
  })

  it("marks a reminder failed with a safe reason when delivery is rejected", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)
    deps.sendTaskEmail = async (): Promise<never> => {
      throw new TaskServiceError(
        "Recipient email address is invalid.",
        400
      )
    }

    const summary = await processDueTaskReminders(deps)

    expect(summary).toEqual({
      scannedCount: 1,
      sentCount: 0,
      failedCount: 1,
      retryingCount: 0,
      skippedCount: 0,
    })
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "failed",
      sent_at: null,
      attempt_count: 1,
      last_error: "Recipient email address is invalid.",
    })
  })

  it("leaves a reminder pending for retry when delivery encounters a transient error", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)
    deps.sendTaskEmail = async (): Promise<never> => {
      throw new TaskServiceError(
        "Unable to send the task email. Try again shortly.",
        502
      )
    }

    const summary = await processDueTaskReminders(deps)

    expect(summary).toEqual({
      scannedCount: 1,
      sentCount: 0,
      failedCount: 0,
      retryingCount: 1,
      skippedCount: 0,
    })
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "pending",
      sent_at: null,
      attempt_count: 1,
      last_error: "Unable to send the task email. Try again shortly.",
    })
  })

  it("marks a reminder failed when attempt count reaches TASK_REMINDER_MAX_ATTEMPTS", async () => {
    const client = createReminderClient([
      createTaskReminderRow({ attempt_count: TASK_REMINDER_MAX_ATTEMPTS - 1 }),
    ])
    const deps = createDeps(client)
    deps.sendTaskEmail = async (): Promise<never> => {
      throw new TaskServiceError("Email delivery failed.", 502)
    }

    const summary = await processDueTaskReminders(deps)

    expect(summary).toEqual({
      scannedCount: 1,
      sentCount: 0,
      failedCount: 1,
      retryingCount: 0,
      skippedCount: 0,
    })
    expect(client.tables.task_reminders[0]).toMatchObject({
      status: "failed",
      attempt_count: TASK_REMINDER_MAX_ATTEMPTS,
    })
  })

  it("never leaks a provider error into the stored failure reason", async () => {
    const client = createReminderClient([createTaskReminderRow()])
    const deps = createDeps(client)
    deps.sendTaskEmail = async (): Promise<never> => {
      throw new Error("resend 422 {\"to\":\"staff@example.com\"}")
    }

    await processDueTaskReminders(deps)

    expect(client.tables.task_reminders[0].last_error).toBe(
      "Task reminder delivery failed."
    )
  })

  it.each([
    ["completed", CREATED_AT],
    ["cancelled", null],
  ])(
    "fails a reminder whose task is already %s without sending",
    async (status: string, completedAt: string | null) => {
      const client = createReminderClient(
        [createTaskReminderRow()],
        [createTaskRow({ status, completed_at: completedAt })]
      )
      const deps = createDeps(client)

      const summary = await processDueTaskReminders(deps)

      expect(summary).toMatchObject({ failedCount: 1, sentCount: 0 })
      expect(deps.sendTaskEmail).not.toHaveBeenCalled()
      expect(client.tables.task_reminders[0]).toMatchObject({
        status: "failed",
        last_error: "The task was already closed before the reminder was due.",
      })
    }
  )

  it("fails a reminder whose task no longer exists", async () => {
    const client = createReminderClient(
      [createTaskReminderRow({ task_id: MISSING_TASK_ID })],
      []
    )
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ failedCount: 1 })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
    expect(client.tables.task_reminders[0].last_error).toBe(
      "The linked task is no longer available."
    )
  })

  it("fails a reminder whose recipient is no longer an active member", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        createMembershipRow("staff", {
          user_id: STAFF_ID,
          status: "disabled",
        }),
      ],
      profiles: [createProfileRow()],
      tasks: [createTaskRow()],
      task_reminders: [createTaskReminderRow()],
    })
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({ failedCount: 1 })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
    expect(client.tables.task_reminders[0].last_error).toBe(
      "The reminder recipient is no longer an active member."
    )
  })

  it("caps one pass at the bounded batch size", async () => {
    const overflowCount = 5
    const dueReminders = Array.from(
      { length: TASK_REMINDER_BATCH_LIMIT + overflowCount },
      (_value: unknown, index: number): FakeRow =>
        createTaskReminderRow({
          id: `50000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        })
    )
    const client = createReminderClient(dueReminders)
    const deps = createDeps(client)

    const summary = await processDueTaskReminders(deps)

    expect(summary).toMatchObject({
      scannedCount: TASK_REMINDER_BATCH_LIMIT,
      sentCount: TASK_REMINDER_BATCH_LIMIT,
    })
    expect(deps.sendTaskEmail).toHaveBeenCalledTimes(TASK_REMINDER_BATCH_LIMIT)
    expect(
      client.tables.task_reminders.filter(
        (row: FakeRow): boolean => row.status === "pending"
      )
    ).toHaveLength(overflowCount)
  })
})

describe("notifyTaskAssignee", () => {
  const assignedTaskRow = createTaskRow({
    assigned_to: STAFF_ID,
    assigned_by: MANAGER_ID,
    assigned_at: CREATED_AT,
  })

  it("emails the current assignee", async () => {
    const client = createReminderClient([], [{ ...assignedTaskRow }])
    const deps = createDeps(client)

    const result = await notifyTaskAssignee(
      {
        organizationId: ORG_ID,
        taskId: TASK_ID,
        assignedToUserId: STAFF_ID,
      },
      deps
    )

    expect(result).toEqual({ delivered: true, skippedReason: null })
    expect(deps.sendTaskEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "assigned",
        deliveryReference: `task-assigned/${TASK_ID}/${STAFF_ID}/${CREATED_AT}`,
        recipientEmail: "staff@example.com",
      })
    )
  })

  it("skips a stale event whose assignee already changed", async () => {
    const client = createReminderClient([], [createTaskRow()])
    const deps = createDeps(client)

    const result = await notifyTaskAssignee(
      {
        organizationId: ORG_ID,
        taskId: TASK_ID,
        assignedToUserId: STAFF_ID,
      },
      deps
    )

    expect(result).toEqual({
      delivered: false,
      skippedReason: "assignment_changed",
    })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
  })

  it("skips a task that was closed before the event was handled", async () => {
    const client = createReminderClient(
      [],
      [{ ...assignedTaskRow, status: "cancelled" }]
    )
    const deps = createDeps(client)

    const result = await notifyTaskAssignee(
      {
        organizationId: ORG_ID,
        taskId: TASK_ID,
        assignedToUserId: STAFF_ID,
      },
      deps
    )

    expect(result).toEqual({ delivered: false, skippedReason: "task_closed" })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
  })

  it("skips an assignee without a reachable active membership", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        createMembershipRow("staff", { user_id: STAFF_ID, status: "disabled" }),
      ],
      profiles: [createProfileRow()],
      tasks: [{ ...assignedTaskRow }],
    })
    const deps = createDeps(client)

    const result = await notifyTaskAssignee(
      {
        organizationId: ORG_ID,
        taskId: TASK_ID,
        assignedToUserId: STAFF_ID,
      },
      deps
    )

    expect(result).toEqual({
      delivered: false,
      skippedReason: "recipient_unavailable",
    })
    expect(deps.sendTaskEmail).not.toHaveBeenCalled()
  })

  it("reports an unknown task as not found", async () => {
    const client = createReminderClient([], [])

    await expect(
      notifyTaskAssignee(
        {
          organizationId: ORG_ID,
          taskId: TASK_ID,
          assignedToUserId: STAFF_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
