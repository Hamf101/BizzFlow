import { NonRetriableError } from "inngest"
import { describe, expect, it, vi } from "vitest"

import { taskAssignedEvent } from "@/inngest/client"
import {
  handleTaskAssigned,
  taskAssignedFunction,
} from "@/inngest/functions/task-assigned"
import { createRecordingStep } from "@/inngest/functions/test-support"
import {
  TaskServiceError,
  type TaskNotificationResult,
} from "@/services/task-service"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const TASK_ID = "30000000-0000-4000-8000-000000000001"
const ASSIGNEE_ID = "20000000-0000-4000-8000-000000000003"
const ASSIGNER_ID = "20000000-0000-4000-8000-000000000002"

const DELIVERED: TaskNotificationResult = {
  delivered: true,
  skippedReason: null,
}

function createEventData(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    taskId: TASK_ID,
    assignedToUserId: ASSIGNEE_ID,
    assignedByUserId: ASSIGNER_ID,
    ...overrides,
  }
}

describe("handleTaskAssigned", () => {
  it("passes only identifiers to the service and returns its result", async () => {
    const notifyTaskAssignee = vi.fn(
      async (): Promise<TaskNotificationResult> => DELIVERED
    )
    const step = createRecordingStep()

    await expect(
      handleTaskAssigned(
        { event: { data: createEventData({ title: "stale title" }) }, step },
        { notifyTaskAssignee }
      )
    ).resolves.toEqual(DELIVERED)
    expect(notifyTaskAssignee).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      taskId: TASK_ID,
      assignedToUserId: ASSIGNEE_ID,
    })
    expect(step.stepIds).toEqual(["notify-task-assignee"])
  })

  it("reports a skip decided by the service", async () => {
    const skipped: TaskNotificationResult = {
      delivered: false,
      skippedReason: "assignment_changed",
    }
    const notifyTaskAssignee = vi.fn(
      async (): Promise<TaskNotificationResult> => skipped
    )

    await expect(
      handleTaskAssigned(
        { event: { data: createEventData() }, step: createRecordingStep() },
        { notifyTaskAssignee }
      )
    ).resolves.toEqual(skipped)
  })

  it("never retries a payload that is missing identifiers", async () => {
    const notifyTaskAssignee = vi.fn(
      async (): Promise<TaskNotificationResult> => DELIVERED
    )
    const step = createRecordingStep()

    await expect(
      handleTaskAssigned(
        { event: { data: { taskId: TASK_ID } }, step },
        { notifyTaskAssignee }
      )
    ).rejects.toBeInstanceOf(NonRetriableError)
    expect(notifyTaskAssignee).not.toHaveBeenCalled()
    expect(step.stepIds).toEqual([])
  })

  it("never retries a payload whose identifiers are not uuids", async () => {
    const notifyTaskAssignee = vi.fn(
      async (): Promise<TaskNotificationResult> => DELIVERED
    )

    await expect(
      handleTaskAssigned(
        {
          event: { data: createEventData({ taskId: "not-a-uuid" }) },
          step: createRecordingStep(),
        },
        { notifyTaskAssignee }
      )
    ).rejects.toBeInstanceOf(NonRetriableError)
    expect(notifyTaskAssignee).not.toHaveBeenCalled()
  })

  it("stops retrying when the service rejects the notification", async () => {
    const notifyTaskAssignee = vi.fn(async (): Promise<never> => {
      throw new TaskServiceError("Task was not found.", 404)
    })

    await expect(
      handleTaskAssigned(
        { event: { data: createEventData() }, step: createRecordingStep() },
        { notifyTaskAssignee }
      )
    ).rejects.toBeInstanceOf(NonRetriableError)
  })

  it("lets an unexpected service failure retry", async () => {
    const notifyTaskAssignee = vi.fn(async (): Promise<never> => {
      throw new TaskServiceError("Unable to send the task email.", 502)
    })

    await expect(
      handleTaskAssigned(
        { event: { data: createEventData() }, step: createRecordingStep() },
        { notifyTaskAssignee }
      )
    ).rejects.not.toBeInstanceOf(NonRetriableError)
  })
})

describe("taskAssignedFunction", () => {
  it("is triggered by the published assignment event", () => {
    expect(taskAssignedFunction.opts.id).toBe("notify-task-assignee")
    expect(taskAssignedFunction.opts.triggers).toEqual([taskAssignedEvent])
    expect(taskAssignedEvent.event).toBe("task/assigned")
  })
})
