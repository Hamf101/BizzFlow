import { describe, expect, it } from "vitest"

import {
  assignTask,
  createTask,
  getTask,
  listTasks,
  transitionTaskStatus,
  updateTask,
} from "@/services/task-service"
import {
  createDeps,
  createMembershipRow,
  createMembershipRows,
  createSubmissionRow,
  createTaskRow,
  createTaskReminderRow,
  FakeSupabaseClient,
  type FakeRow,
  CREATED_AT,
  FUTURE_AT,
  MANAGER_ID,
  NEW_TASK_ID,
  NOW,
  ORG_ID,
  OTHER_ORG_ID,
  OWNER_ID,
  OUTSIDER_ID,
  REVIEWER_ID,
  STAFF_ID,
  SUBMISSION_ID,
  TASK_ID,
} from "@/services/task-service.test-support"
import type { TaskStatus } from "@/types/task"

const SECOND_TASK_ID = "30000000-0000-4000-8000-000000000002"
const THIRD_TASK_ID = "30000000-0000-4000-8000-000000000003"

function createClient(tasks: Record<string, unknown>[] = []): FakeSupabaseClient {
  return new FakeSupabaseClient({
    organization_memberships: createMembershipRows(),
    submissions: [createSubmissionRow()],
    tasks,
  })
}

describe("createTask", () => {
  it("creates an open task at revision 1 and records the audit event", async () => {
    const client = createClient()
    const deps = createDeps(client, [NEW_TASK_ID])

    const task = await createTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        title: "  Chase   missing W-9  ",
        description: " Ask the vendor again. ",
        dueAt: "2026-07-31T09:00:00Z",
      },
      deps
    )

    expect(task).toMatchObject({
      id: NEW_TASK_ID,
      organizationId: ORG_ID,
      title: "Chase missing W-9",
      description: "Ask the vendor again.",
      status: "open",
      dueAt: FUTURE_AT,
      completedAt: null,
      assignedTo: null,
      assignedBy: null,
      assignedAt: null,
      createdBy: MANAGER_ID,
      updatedBy: MANAGER_ID,
      revision: 1,
      createdAt: NOW,
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "task.created",
        targetType: "task",
        targetId: NEW_TASK_ID,
        organizationId: ORG_ID,
        actorUserId: MANAGER_ID,
      })
    )
  })

  it("links a task to a submission in the same tenant", async () => {
    const client = createClient()
    const deps = createDeps(client, [NEW_TASK_ID])

    const task = await createTask(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        title: "Review submitted answers",
        submissionId: SUBMISSION_ID,
      },
      deps
    )

    expect(task.submissionId).toBe(SUBMISSION_ID)
  })

  it("rejects a submission link that belongs to another tenant", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: createMembershipRows(),
      submissions: [createSubmissionRow({ org_id: OTHER_ORG_ID })],
    })

    await expect(
      createTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          title: "Review submitted answers",
          submissionId: SUBMISSION_ID,
        },
        createDeps(client, [NEW_TASK_ID])
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("assigns at creation when the actor may assign", async () => {
    const client = createClient()
    const deps = createDeps(client, [NEW_TASK_ID])

    const task = await createTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        title: "Collect the deposit",
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(task).toMatchObject({
      assignedTo: STAFF_ID,
      assignedBy: MANAGER_ID,
      assignedAt: NOW,
    })
    expect(deps.publishTaskAssigned).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      taskId: NEW_TASK_ID,
      assignedToUserId: STAFF_ID,
      assignedByUserId: MANAGER_ID,
    })
  })

  it("rejects assignment at creation by a role without the assign action", async () => {
    const client = createClient()

    await expect(
      createTask(
        {
          actorUserId: STAFF_ID,
          organizationId: ORG_ID,
          title: "Collect the deposit",
          assignedTo: STAFF_ID,
        },
        createDeps(client, [NEW_TASK_ID])
      )
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(client.tables.tasks).toHaveLength(0)
  })

  it("rejects an external reviewer as the assignee", async () => {
    const client = createClient()

    await expect(
      createTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          title: "Collect the deposit",
          assignedTo: REVIEWER_ID,
        },
        createDeps(client, [NEW_TASK_ID])
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an external reviewer creating tasks", async () => {
    const client = createClient()

    await expect(
      createTask(
        {
          actorUserId: REVIEWER_ID,
          organizationId: ORG_ID,
          title: "Collect the deposit",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects an actor with no membership in the tenant", async () => {
    const client = createClient()

    await expect(
      createTask(
        {
          actorUserId: OUTSIDER_ID,
          organizationId: ORG_ID,
          title: "Collect the deposit",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    ["an empty title", "   "],
    ["a title over 200 characters", "x".repeat(201)],
  ])("rejects %s", async (_label: string, title: string) => {
    const client = createClient()

    await expect(
      createTask(
        { actorUserId: MANAGER_ID, organizationId: ORG_ID, title },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an unparsable due date", async () => {
    const client = createClient()

    await expect(
      createTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          title: "Collect the deposit",
          dueAt: "next tuesday",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe("listTasks", () => {
  it("orders by due date with undated tasks last and excludes other tenants", async () => {
    const client = createClient([
      createTaskRow({ id: TASK_ID, due_at: FUTURE_AT }),
      createTaskRow({ id: SECOND_TASK_ID, due_at: null }),
      createTaskRow({ id: THIRD_TASK_ID, due_at: "2026-07-30T18:00:00.000Z" }),
      createTaskRow({ id: NEW_TASK_ID, org_id: OTHER_ORG_ID }),
    ])

    const tasks = await listTasks(
      { actorUserId: STAFF_ID, organizationId: ORG_ID },
      createDeps(client)
    )

    expect(tasks.map((task): string => task.id)).toEqual([
      THIRD_TASK_ID,
      TASK_ID,
      SECOND_TASK_ID,
    ])
  })

  it("filters by status and assignee", async () => {
    const client = createClient([
      createTaskRow({ id: TASK_ID, status: "open" }),
      createTaskRow({
        id: SECOND_TASK_ID,
        status: "in_progress",
        assigned_to: STAFF_ID,
        assigned_by: MANAGER_ID,
        assigned_at: CREATED_AT,
      }),
      createTaskRow({
        id: THIRD_TASK_ID,
        status: "completed",
        completed_at: CREATED_AT,
      }),
    ])

    const openWork = await listTasks(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        statuses: ["open", "in_progress"],
      },
      createDeps(client)
    )
    const staffWork = await listTasks(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        assignedTo: STAFF_ID,
      },
      createDeps(client)
    )

    expect(openWork.map((task): string => task.id).sort()).toEqual(
      [TASK_ID, SECOND_TASK_ID].sort()
    )
    expect(staffWork.map((task): string => task.id)).toEqual([SECOND_TASK_ID])
  })

  it("filters by originating submission", async () => {
    const client = createClient([
      createTaskRow({ id: TASK_ID, submission_id: SUBMISSION_ID }),
      createTaskRow({ id: SECOND_TASK_ID }),
    ])

    const tasks = await listTasks(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        submissionId: SUBMISSION_ID,
      },
      createDeps(client)
    )

    expect(tasks.map((task): string => task.id)).toEqual([TASK_ID])
  })

  it("rejects an unsupported status filter", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      listTasks(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          statuses: ["archived"] as unknown as TaskStatus[],
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects a limit outside the supported range", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      listTasks(
        { actorUserId: MANAGER_ID, organizationId: ORG_ID, limit: 500 },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an external reviewer", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      listTasks(
        { actorUserId: REVIEWER_ID, organizationId: ORG_ID },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("getTask", () => {
  it("returns the task with its reminders", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: createMembershipRows(),
      tasks: [createTaskRow()],
      task_reminders: [createTaskReminderRow()],
    })

    const detail = await getTask(
      { actorUserId: STAFF_ID, organizationId: ORG_ID, taskId: TASK_ID },
      createDeps(client)
    )

    expect(detail.task.id).toBe(TASK_ID)
    expect(detail.reminders).toHaveLength(1)
    expect(detail.reminders[0]).toMatchObject({
      taskId: TASK_ID,
      status: "pending",
      sentAt: null,
    })
  })

  it("hides a task owned by another tenant", async () => {
    const client = createClient([createTaskRow({ org_id: OTHER_ORG_ID })])

    await expect(
      getTask(
        { actorUserId: MANAGER_ID, organizationId: ORG_ID, taskId: TASK_ID },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it("rejects an actor whose membership is in a different tenant", async () => {
    const client = createClient([createTaskRow({ org_id: OTHER_ORG_ID })])

    await expect(
      getTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: OTHER_ORG_ID,
          taskId: TASK_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("updateTask", () => {
  it("applies changed fields and advances the revision once", async () => {
    const client = createClient([createTaskRow({ revision: 3 })])
    const deps = createDeps(client)

    const task = await updateTask(
      {
        actorUserId: STAFF_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 3,
        title: "Collect the countersigned lease",
        description: null,
        dueAt: null,
      },
      deps
    )

    expect(task).toMatchObject({
      title: "Collect the countersigned lease",
      description: null,
      dueAt: null,
      revision: 4,
      updatedBy: STAFF_ID,
      updatedAt: NOW,
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.updated", targetId: TASK_ID })
    )
  })

  it("rejects a stale expected revision", async () => {
    const client = createClient([createTaskRow({ revision: 3 })])

    await expect(
      updateTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 2,
          title: "Collect the countersigned lease",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("rejects a concurrent writer that changed the row after it was read", async () => {
    const client = createClient([createTaskRow({ revision: 3 })])
    client.onNextUpdate("tasks", (): void => {
      client.tables.tasks[0].revision = 4
    })

    await expect(
      updateTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 3,
          title: "Collect the countersigned lease",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(client.tables.tasks[0].title).toBe("Collect signed lease")
  })

  it.each(["completed", "cancelled"])(
    "rejects editing a %s task",
    async (status: string) => {
      const client = createClient([
        createTaskRow({
          status,
          completed_at: status === "completed" ? CREATED_AT : null,
        }),
      ])

      await expect(
        updateTask(
          {
            actorUserId: MANAGER_ID,
            organizationId: ORG_ID,
            taskId: TASK_ID,
            expectedRevision: 1,
            title: "Collect the countersigned lease",
          },
          createDeps(client)
        )
      ).rejects.toMatchObject({ statusCode: 409 })
    }
  )

  it("rejects an update that changes nothing", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      updateTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects a non-positive expected revision", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      updateTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 0,
          title: "Collect the countersigned lease",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects an external reviewer", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      updateTask(
        {
          actorUserId: REVIEWER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          title: "Collect the countersigned lease",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("assignTask", () => {
  it("records the whole assignment triple and publishes the event", async () => {
    const client = createClient([createTaskRow()])
    const deps = createDeps(client)

    const task = await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(task).toMatchObject({
      assignedTo: STAFF_ID,
      assignedBy: MANAGER_ID,
      assignedAt: NOW,
      revision: 2,
    })
    expect(deps.publishTaskAssigned).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: TASK_ID, assignedToUserId: STAFF_ID })
    )
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.assigned" })
    )
  })

  it("clears the whole assignment triple when unassigning", async () => {
    const client = createClient([
      createTaskRow({
        assigned_to: STAFF_ID,
        assigned_by: MANAGER_ID,
        assigned_at: CREATED_AT,
      }),
    ])
    const deps = createDeps(client)

    const task = await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: null,
      },
      deps
    )

    expect(task).toMatchObject({
      assignedTo: null,
      assignedBy: null,
      assignedAt: null,
    })
    expect(deps.publishTaskAssigned).not.toHaveBeenCalled()
  })

  it("rejects staff, who may edit but never assign", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      assignTask(
        {
          actorUserId: STAFF_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          assignedTo: STAFF_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects an assignee who is not an active internal member", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        createMembershipRow("manager"),
        createMembershipRow("staff", {
          user_id: STAFF_ID,
          status: "disabled",
        }),
      ],
      tasks: [createTaskRow()],
    })

    await expect(
      assignTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          assignedTo: STAFF_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects assigning a cancelled task", async () => {
    const client = createClient([createTaskRow({ status: "cancelled" })])

    await expect(
      assignTask(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          assignedTo: STAFF_ID,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("keeps the operation successful when publishing the event fails", async () => {
    const client = createClient([createTaskRow()])
    const deps = createDeps(client)
    deps.publishTaskAssigned = async (): Promise<never> => {
      throw new Error("queue offline")
    }

    const task = await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(task.assignedTo).toBe(STAFF_ID)
  })
})

describe("transitionTaskStatus", () => {
  const allowedTransitions: Array<[TaskStatus, TaskStatus]> = [
    ["open", "in_progress"],
    ["open", "completed"],
    ["open", "cancelled"],
    ["in_progress", "completed"],
    ["in_progress", "cancelled"],
  ]

  it.each(allowedTransitions)(
    "moves a task from %s to %s",
    async (from: TaskStatus, to: TaskStatus) => {
      const client = createClient([createTaskRow({ status: from })])
      const deps = createDeps(client)

      const task = await transitionTaskStatus(
        {
          actorUserId: STAFF_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          targetStatus: to,
        },
        deps
      )

      expect(task.status).toBe(to)
      expect(task.completedAt).toBe(to === "completed" ? NOW : null)
      expect(task.revision).toBe(2)
      expect(deps.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "task.status_changed",
          metadata: { fromStatus: from, toStatus: to },
        })
      )
    }
  )

  const forbiddenTransitions: Array<[TaskStatus, TaskStatus]> = [
    ["open", "open"],
    ["in_progress", "open"],
    ["in_progress", "in_progress"],
    ["completed", "open"],
    ["completed", "in_progress"],
    ["completed", "cancelled"],
    ["completed", "completed"],
    ["cancelled", "open"],
    ["cancelled", "in_progress"],
    ["cancelled", "completed"],
    ["cancelled", "cancelled"],
  ]

  it.each(forbiddenTransitions)(
    "refuses to move a task from %s to %s",
    async (from: TaskStatus, to: TaskStatus) => {
      const client = createClient([
        createTaskRow({
          status: from,
          completed_at: from === "completed" ? CREATED_AT : null,
        }),
      ])

      await expect(
        transitionTaskStatus(
          {
            actorUserId: MANAGER_ID,
            organizationId: ORG_ID,
            taskId: TASK_ID,
            expectedRevision: 1,
            targetStatus: to,
          },
          createDeps(client)
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(client.tables.tasks[0].status).toBe(from)
    }
  )

  it("rejects an unsupported target status", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      transitionTaskStatus(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          targetStatus: "archived" as TaskStatus,
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it("rejects a stale expected revision", async () => {
    const client = createClient([createTaskRow({ revision: 2 })])

    await expect(
      transitionTaskStatus(
        {
          actorUserId: MANAGER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          targetStatus: "completed",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("rejects an external reviewer", async () => {
    const client = createClient([createTaskRow()])

    await expect(
      transitionTaskStatus(
        {
          actorUserId: REVIEWER_ID,
          organizationId: ORG_ID,
          taskId: TASK_ID,
          expectedRevision: 1,
          targetStatus: "completed",
        },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("automatic due reminders", () => {
  const REMINDER_A = "50000000-0000-4000-8000-0000000000a1"

  function pendingAutomatic(client: FakeSupabaseClient): FakeRow[] {
    return client.tables.task_reminders.filter(
      (row: FakeRow): boolean =>
        row.origin === "automatic" && row.status === "pending"
    )
  }

  it("schedules a reminder for the assignee when a task is created with a due date", async () => {
    const client = createClient()
    const deps = createDeps(client, [NEW_TASK_ID, REMINDER_A])

    await createTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        title: "Chase the signed lease",
        dueAt: FUTURE_AT,
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({
        task_id: NEW_TASK_ID,
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
        channel: "email",
        origin: "automatic",
        status: "pending",
      }),
    ])
  })

  it.each([
    ["there is no assignee to remind", { dueAt: FUTURE_AT }],
    ["there is no due date", { assignedTo: STAFF_ID }],
    [
      "the due date has already passed",
      { assignedTo: STAFF_ID, dueAt: CREATED_AT },
    ],
  ])("schedules nothing when %s", async (_label, overrides) => {
    const client = createClient()
    const deps = createDeps(client, [NEW_TASK_ID, REMINDER_A])

    await createTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        title: "Chase the signed lease",
        ...overrides,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([])
  })

  it("moves the reminder to the new assignee on reassignment", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client, ["50000000-0000-4000-8000-0000000000a2"])

    await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: OWNER_ID,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({
        recipient_user_id: OWNER_ID,
        remind_at: FUTURE_AT,
      }),
    ])
    // Superseded, not cancelled: the sync displaced this row itself, so
    // reassigning back to STAFF_ID must be able to revive it.
    expect(
      client.tables.task_reminders.find((row: FakeRow) => row.id === REMINDER_A)
        ?.status
    ).toBe("superseded")
  })

  it("cancels the reminder when the task is completed", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client)

    await transitionTaskStatus(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        targetStatus: "completed",
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([])
  })

  it("never touches a reminder a member scheduled by hand", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "manual",
        recipient_user_id: OWNER_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client)

    await transitionTaskStatus(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        targetStatus: "cancelled",
      },
      deps
    )

    expect(
      client.tables.task_reminders.find((row: FakeRow) => row.id === REMINDER_A)
    ).toMatchObject({ origin: "manual", status: "pending" })
  })

  it("does not resurrect an automatic reminder that was already cancelled", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
        status: "cancelled",
      })
    )
    const deps = createDeps(client)

    await updateTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        title: "Renamed but same due date",
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([])
    expect(client.tables.task_reminders).toHaveLength(1)
  })

  // Regression: `alreadyScheduled` matched every reminder regardless of status,
  // and (task, recipient, instant) is a status-blind unique key, so a row the
  // sync had retired itself permanently blocked the reminder coming back.
  it("restores the reminder when a task is reassigned back to the first assignee", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client, [
      "50000000-0000-4000-8000-0000000000a2",
      "50000000-0000-4000-8000-0000000000a3",
    ])

    await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: OWNER_ID,
      },
      deps
    )
    await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 2,
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({
        id: REMINDER_A,
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      }),
    ])
    // Revived in place — the unique key means no second row may exist.
    expect(client.tables.task_reminders).toHaveLength(2)
  })

  it("restores the reminder when a due date is moved away and back", async () => {
    const MOVED_AT = "2026-08-06T09:00:00.000Z"
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client, ["50000000-0000-4000-8000-0000000000a4"])

    await updateTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        dueAt: MOVED_AT,
      },
      deps
    )
    await updateTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 2,
        dueAt: FUTURE_AT,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({ id: REMINDER_A, remind_at: FUTURE_AT }),
    ])
  })

  it("restores the reminder when a task is unassigned and reassigned", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client)

    await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        assignedTo: null,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([])

    await assignTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 2,
        assignedTo: STAFF_ID,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({ id: REMINDER_A, recipient_user_id: STAFF_ID }),
    ])
  })

  it("keeps a closed task's reminder cancelled and out of revival", async () => {
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client)

    await transitionTaskStatus(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        targetStatus: "completed",
      },
      deps
    )

    // Cancelled, not superseded: a terminal task cannot reopen, so the row is
    // final and stays visible in the task's reminder history.
    expect(
      client.tables.task_reminders.find((row: FakeRow) => row.id === REMINDER_A)
        ?.status
    ).toBe("cancelled")
  })

  it("does not duplicate a manual reminder already set for that exact instant", async () => {
    // (task, recipient, instant) is a unique key across both origins.
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "manual",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client)

    await updateTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        title: "Renamed, same due date and assignee",
      },
      deps
    )

    expect(client.tables.task_reminders).toHaveLength(1)
    expect(client.tables.task_reminders[0]).toMatchObject({
      origin: "manual",
      status: "pending",
    })
  })

  it("reschedules to the new instant when the due date moves", async () => {
    const LATER_AT = "2026-08-05T09:00:00.000Z"
    const client = createClient([
      createTaskRow({ due_at: FUTURE_AT, ...assignedTo(STAFF_ID) }),
    ])
    client.tables.task_reminders.push(
      createTaskReminderRow({
        id: REMINDER_A,
        origin: "automatic",
        recipient_user_id: STAFF_ID,
        remind_at: FUTURE_AT,
      })
    )
    const deps = createDeps(client, ["50000000-0000-4000-8000-0000000000a3"])

    await updateTask(
      {
        actorUserId: MANAGER_ID,
        organizationId: ORG_ID,
        taskId: TASK_ID,
        expectedRevision: 1,
        dueAt: LATER_AT,
      },
      deps
    )

    expect(pendingAutomatic(client)).toEqual([
      expect.objectContaining({
        recipient_user_id: STAFF_ID,
        remind_at: LATER_AT,
      }),
    ])
  })
})

function assignedTo(userId: string): Record<string, unknown> {
  return {
    assigned_to: userId,
    assigned_by: MANAGER_ID,
    assigned_at: CREATED_AT,
  }
}
