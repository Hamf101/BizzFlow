import { describe, expect, it, vi } from "vitest"

import { publishTaskAssigned } from "@/inngest/publish-task-assigned"

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const TASK_ID = "30000000-0000-4000-8000-000000000001"
const ASSIGNEE_USER_ID = "20000000-0000-4000-8000-000000000003"
const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000002"

const notification = {
  organizationId: ORGANIZATION_ID,
  taskId: TASK_ID,
  assignedToUserId: ASSIGNEE_USER_ID,
  assignedByUserId: ACTOR_USER_ID,
}

describe("publishTaskAssigned", () => {
  it("publishes an identifier-only task/assigned event", async () => {
    const send = vi.fn().mockResolvedValue(undefined)

    await publishTaskAssigned(notification, { send })

    expect(send).toHaveBeenCalledTimes(1)
    const payload = send.mock.calls[0][0]
    expect(payload.name).toBe("task/assigned")
    expect(payload.data).toEqual(notification)
    await expect(payload.validate()).resolves.toBeUndefined()
  })

  it("surfaces an event-bus rejection to its caller", async () => {
    const send = vi.fn().mockRejectedValue(new Error("event bus unavailable"))

    await expect(publishTaskAssigned(notification, { send })).rejects.toThrow(
      "event bus unavailable"
    )
  })
})
