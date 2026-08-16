import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import type { OrganizationRole } from "@/lib/permissions"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  assignInternalSubmission,
  createInternalSubmissionComment,
  transitionInternalSubmission,
} from "@/services/submission-service"

import {
  assignSubmissionAction,
  createSubmissionCommentAction,
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("derives assignment tenant and actor values on the server", async () => {
    const formData = createSubmissionFormData()
    formData.set("assignedTo", ASSIGNEE_USER_ID)
    formData.set("organizationId", "untrusted-organization")

    await expect(assignSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?message=Submission+assigned.`
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
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?error=You+do+not+have+permission+to+perform+this+submission+action.`
    )

    expect(transitionInternalSubmission).not.toHaveBeenCalled()
  })

  it("requires an explanatory note before rejecting", async () => {
    const formData = createSubmissionFormData()
    formData.set("targetStatus", "rejected")

    await expect(transitionSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?error=Add+a+note+explaining+why+the+submission+was+rejected.`
    )

    expect(transitionInternalSubmission).not.toHaveBeenCalled()
  })

  it("passes a validated binding decision with the current revision", async () => {
    const formData = createSubmissionFormData()
    formData.set("targetStatus", "approved")

    await expect(transitionSubmissionAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?message=Submission+approved.`
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
      `NEXT_REDIRECT:/submissions/${SUBMISSION_ID}?message=Comment+added.`
    )

    expect(createInternalSubmissionComment).toHaveBeenCalledWith({
      actorUserId: ACTOR_USER_ID,
      organizationId: ORGANIZATION_ID,
      submissionId: SUBMISSION_ID,
      body: "Please confirm the effective date.",
    })
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
