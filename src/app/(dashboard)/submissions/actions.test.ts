import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import type { OrganizationRole } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  assignInternalSubmission,
  createInternalSubmissionDraft,
  createInternalSubmissionComment,
  saveInternalSubmissionDraft,
  SubmissionServiceError,
  submitInternalSubmission,
  transitionInternalSubmission,
} from "@/services/submission-service"

import {
  assignSubmissionAction,
  createSubmissionAction,
  createSubmissionCommentAction,
  saveSubmissionAction,
  submitSubmissionAction,
  transitionSubmissionAction,
} from "./actions"

const ACTOR_USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "30000000-0000-4000-8000-000000000001"
const ASSIGNEE_USER_ID = "40000000-0000-4000-8000-000000000001"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/submission-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/submission-service")>()
  return {
    ...actual,
    assignInternalSubmission: vi.fn(),
    createInternalSubmissionComment: vi.fn(),
    createInternalSubmissionDraft: vi.fn(),
    saveInternalSubmissionDraft: vi.fn(),
    submitInternalSubmission: vi.fn(),
    transitionInternalSubmission: vi.fn(),
  }
})

describe("submission review actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ACTOR_USER_ID,
      email: "manager@example.com",
    })
    mockOrganizationContext("manager")
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(createInternalSubmissionDraft).mockResolvedValue({
      id: SUBMISSION_ID,
    } as never)
    vi.mocked(saveInternalSubmissionDraft).mockResolvedValue(undefined as never)
    vi.mocked(submitInternalSubmission).mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("derives assignment tenant and actor values on the server", async () => {
    const formData = createSubmissionFormData()
    formData.set("assignedTo", ASSIGNEE_USER_ID)
    formData.set("organizationId", "untrusted-organization")

    await expect(assignSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=submission_assigned`
    )

    expect(assignInternalSubmission).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      expectedRevision: 3,
      assignedTo: ASSIGNEE_USER_ID,
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/submissions")
    expect(revalidatePathMock).toHaveBeenCalledWith(
      `/submissions/${SUBMISSION_ID}`
    )
  })

  it("blocks binding decisions from an external reviewer", async () => {
    mockOrganizationContext("external_reviewer")
    const formData = createSubmissionFormData()
    formData.set("targetStatus", "approved")

    await expect(transitionSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=permission_denied`
    )

    expect(transitionInternalSubmission).not.toHaveBeenCalled()
  })

  it("requires an explanatory note before rejecting", async () => {
    const formData = createSubmissionFormData()
    formData.set("targetStatus", "rejected")

    await expect(transitionSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=invalid_input`
    )

    expect(transitionInternalSubmission).not.toHaveBeenCalled()
  })

  it("passes a validated binding decision with the current revision", async () => {
    const formData = createSubmissionFormData()
    formData.set("targetStatus", "approved")

    await expect(transitionSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=submission_review_updated`
    )

    expect(transitionInternalSubmission).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      expectedRevision: 3,
      targetStatus: "approved",
      comment: undefined,
    })
  })

  it("allows an external reviewer to add a scoped comment", async () => {
    mockOrganizationContext("external_reviewer")
    const formData = createSubmissionFormData()
    formData.set("body", "Please confirm the effective date.")

    await expect(createSubmissionCommentAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=comment_added`
    )

    expect(createInternalSubmissionComment).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      body: "Please confirm the effective date.",
    })
  })

  it("maps submission service details to a fixed conflict outcome", async () => {
    vi.mocked(assignInternalSubmission).mockRejectedValue(
      new SubmissionServiceError("Private revision and tenant detail", 409)
    )
    const formData = createSubmissionFormData()
    formData.set("assignedTo", ASSIGNEE_USER_ID)

    await expect(assignSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=refresh_required`
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Private+revision")
    )
  })
})

describe("submission draft actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ACTOR_USER_ID,
      email: "staff@example.com",
    })
    mockOrganizationContext("staff")
    vi.mocked(createInternalSubmissionDraft).mockResolvedValue({
      id: SUBMISSION_ID,
    } as never)
    vi.mocked(saveInternalSubmissionDraft).mockResolvedValue(undefined as never)
    vi.mocked(submitInternalSubmission).mockResolvedValue(undefined as never)
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("creates a draft and preserves the service-returned id", async () => {
    const formData = new FormData()
    formData.set("submissionId", SUBMISSION_ID)
    formData.set("templateId", "50000000-0000-4000-8000-000000000001")
    formData.set("title", "Quarterly review")

    await expect(createSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=submission_created`
    )
    expect(createInternalSubmissionDraft).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      templateId: "50000000-0000-4000-8000-000000000001",
      title: "Quarterly review",
    })
  })

  it.each([
    {
      action: saveSubmissionAction,
      feedback: "changes_saved",
      operation: saveInternalSubmissionDraft,
    },
    {
      action: submitSubmissionAction,
      feedback: "submission_submitted",
      operation: submitInternalSubmission,
    },
  ])("persists answer changes before reporting $feedback", async ({ action, feedback, operation }) => {
    const formData = createSubmissionFormData()
    formData.set("answer.text.client-name", "Acme")

    await expect(action(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?feedback=${feedback}`
    )
    expect(operation).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      expectedRevision: 3,
      values: { "client-name": "Acme" },
    })
  })

  it("preserves the submission login return path", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(saveSubmissionAction(createSubmissionFormData())).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=%2Fsubmissions%2F${SUBMISSION_ID}`
    )
    expect(saveInternalSubmissionDraft).not.toHaveBeenCalled()
  })
})

function createSubmissionFormData(): FormData {
  const formData = new FormData()
  formData.set("submissionId", SUBMISSION_ID)
  formData.set("expectedRevision", "3")
  return formData
}

function mockOrganizationContext(role: OrganizationRole): void {
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
    organization: {
      id: ORGANIZATION_ID,
      name: "Acme",
      slug: "acme",
      createdBy: ACTOR_USER_ID,
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    },
    membership: {
      id: "membership-1",
      organizationId: ORGANIZATION_ID,
      userId: ACTOR_USER_ID,
      role,
      status: "active",
      createdAt: "2026-07-18T12:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
    },
  })
}
