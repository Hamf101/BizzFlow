import { beforeEach, describe, expect, it, vi } from "vitest"

import { publishTaskAssigned } from "@/inngest/publish-task-assigned"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  assignTask,
  cancelTaskReminder,
  createTask,
  scheduleTaskReminder,
  TaskServiceError,
  transitionTaskStatus,
  updateTask,
} from "@/services/task-service"

import {
  assignTaskAction,
  cancelTaskReminderAction,
  createTaskAction,
  scheduleTaskReminderAction,
  transitionTaskStatusAction,
  updateTaskAction,
} from "./actions"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))

vi.mock("@/inngest/publish-task-assigned", () => ({
  publishTaskAssigned: vi.fn(),
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/task-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/task-service")>()
  return {
    ...actual,
    assignTask: vi.fn(),
    cancelTaskReminder: vi.fn(),
    createTask: vi.fn(),
    scheduleTaskReminder: vi.fn(),
    transitionTaskStatus: vi.fn(),
    updateTask: vi.fn(),
  }
})

const USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const TASK_ID = "30000000-0000-4000-8000-000000000001"
const MEMBER_ID = "40000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "50000000-0000-4000-8000-000000000001"
const REMINDER_ID = "60000000-0000-4000-8000-000000000001"
const TASK_PATH = `/tasks/${TASK_ID}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    id: USER_ID,
    email: "manager@example.com",
  })
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
    organization: { id: ORGANIZATION_ID },
    membership: { role: "manager" },
  } as never)
  vi.mocked(createTask).mockResolvedValue({ id: TASK_ID } as never)
  vi.mocked(updateTask).mockResolvedValue(undefined as never)
  vi.mocked(assignTask).mockResolvedValue(undefined as never)
  vi.mocked(transitionTaskStatus).mockResolvedValue(undefined as never)
  vi.mocked(scheduleTaskReminder).mockResolvedValue(undefined as never)
  vi.mocked(cancelTaskReminder).mockResolvedValue(undefined as never)
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("task mutation actions", () => {
  it("creates a task and opens the service-returned id", async () => {
    const formData = new FormData()
    formData.set("title", "Review submission")
    formData.set("description", "Confirm the totals")
    formData.set("dueAt", "")
    formData.set("assignedTo", MEMBER_ID)
    formData.set("submissionId", SUBMISSION_ID)

    await expect(createTaskAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=task_created`
    )
    expect(createTask).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER_ID,
        assignedTo: MEMBER_ID,
        description: "Confirm the totals",
        dueAt: null,
        organizationId: ORGANIZATION_ID,
        submissionId: SUBMISSION_ID,
        title: "Review submission",
      },
      { publishTaskAssigned }
    )
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/submissions/${SUBMISSION_ID}`
    )
  })

  it("keeps validation failure on the originating submission", async () => {
    const formData = new FormData()
    formData.set("title", "")
    formData.set("description", "")
    formData.set("dueAt", "")
    formData.set("assignedTo", "")
    formData.set("submissionId", SUBMISSION_ID)

    await expect(createTaskAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=invalid_input`
    )
    expect(createTask).not.toHaveBeenCalled()
  })

  it("updates task details before reporting saved", async () => {
    await expect(updateTaskAction(createTaskForm())).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=changes_saved`
    )
    expect(updateTask).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      description: "Updated description",
      dueAt: null,
      expectedRevision: 3,
      organizationId: ORGANIZATION_ID,
      taskId: TASK_ID,
      title: "Updated task",
    })
  })

  it("assigns the task with notification dependencies before reporting saved", async () => {
    const formData = createTaskForm()
    formData.set("assignedTo", MEMBER_ID)

    await expect(assignTaskAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=changes_saved`
    )
    expect(assignTask).toHaveBeenCalledExactlyOnceWith(
      {
        actorUserId: USER_ID,
        assignedTo: MEMBER_ID,
        expectedRevision: 3,
        organizationId: ORGANIZATION_ID,
        taskId: TASK_ID,
      },
      { publishTaskAssigned }
    )
  })

  it("records a lifecycle transition with a dedicated status outcome", async () => {
    const formData = createTaskForm()
    formData.set("targetStatus", "completed")

    await expect(transitionTaskStatusAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=task_status_updated`
    )
    expect(transitionTaskStatus).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      expectedRevision: 3,
      organizationId: ORGANIZATION_ID,
      targetStatus: "completed",
      taskId: TASK_ID,
    })
  })

  it("schedules and cancels reminders only after service authority", async () => {
    const scheduleForm = createTaskForm()
    scheduleForm.set("recipientUserId", MEMBER_ID)
    scheduleForm.set("remindAt", "2026-09-01T12:00:00.000Z")
    scheduleForm.set("channel", "email")

    await expect(scheduleTaskReminderAction(scheduleForm)).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=changes_saved`
    )
    const cancelForm = createTaskForm()
    cancelForm.set("reminderId", REMINDER_ID)
    await expect(cancelTaskReminderAction(cancelForm)).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=changes_saved`
    )
    expect(scheduleTaskReminder).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      channel: "email",
      organizationId: ORGANIZATION_ID,
      recipientUserId: MEMBER_ID,
      remindAt: "2026-09-01T12:00:00.000Z",
      taskId: TASK_ID,
    })
    expect(cancelTaskReminder).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORGANIZATION_ID,
      reminderId: REMINDER_ID,
      taskId: TASK_ID,
    })
  })

  it("maps service diagnostics to a fixed conflict outcome", async () => {
    vi.mocked(updateTask).mockRejectedValue(
      new TaskServiceError("Private task revision detail", 409)
    )

    await expect(updateTaskAction(createTaskForm())).rejects.toThrow(
      `NEXT_REDIRECT:${TASK_PATH}?feedback=refresh_required`
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Private+task")
    )
  })

  it("preserves the task login return path", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(updateTaskAction(createTaskForm())).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=%2Ftasks%2F${TASK_ID}`
    )
    expect(updateTask).not.toHaveBeenCalled()
  })
})

function createTaskForm(): FormData {
  const formData = new FormData()
  formData.set("taskId", TASK_ID)
  formData.set("expectedRevision", "3")
  formData.set("title", "Updated task")
  formData.set("description", "Updated description")
  formData.set("dueAt", "")
  return formData
}
