import { beforeEach, describe, expect, it, vi } from "vitest"

import { reviewSubmissionsInBulk } from "@/services/submissions/bulk-review-service"
import { SubmissionServiceError } from "@/services/submissions/errors"
import { transitionInternalSubmission } from "@/services/submissions/review-service"
import { setInternalSubmissionReviewers } from "@/services/submissions/reviewer-service"

vi.mock("@/services/submissions/review-service", () => ({ transitionInternalSubmission: vi.fn() }))
vi.mock("@/services/submissions/reviewer-service", () => ({ setInternalSubmissionReviewers: vi.fn() }))

const ACTOR = { actorUserId: "user-1", organizationId: "org-1" }

beforeEach(() => vi.clearAllMocks())

describe("reviewSubmissionsInBulk", () => {
  it("starts each one with the reviewer as its only reviewer, at the revision they saw", async () => {
    vi.mocked(setInternalSubmissionReviewers).mockResolvedValue({} as never)

    await expect(
      reviewSubmissionsInBulk({ ...ACTOR, change: "start", items: [{ id: "a", revision: 3 }, { id: "b", revision: 1 }] })
    ).resolves.toEqual({ changed: ["a", "b"], failed: 0 })
    expect(setInternalSubmissionReviewers).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: "a", expectedRevision: 3, reviewerIds: ["user-1"], requiredApprovals: 1 }),
      {}
    )
    expect(transitionInternalSubmission).not.toHaveBeenCalled()
  })

  it("approves each one the service lets them, and counts the rest", async () => {
    vi.mocked(transitionInternalSubmission)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new SubmissionServiceError("Submission changed.", 409))

    await expect(
      reviewSubmissionsInBulk({ ...ACTOR, change: "approve", items: [{ id: "a", revision: 2 }, { id: "b", revision: 5 }] })
    ).resolves.toEqual({ changed: ["a"], failed: 1 })
    expect(transitionInternalSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: "b", expectedRevision: 5, targetStatus: "approved" }),
      {}
    )
  })

  it("refuses more than a page at once, and an unexpected failure", async () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ id: `s${index}`, revision: 1 }))

    await expect(reviewSubmissionsInBulk({ ...ACTOR, change: "approve", items: many })).rejects.toMatchObject({ statusCode: 400 })

    vi.mocked(transitionInternalSubmission).mockRejectedValueOnce(new Error("database down"))
    await expect(reviewSubmissionsInBulk({ ...ACTOR, change: "approve", items: [{ id: "a", revision: 1 }] })).rejects.toThrow("database down")
  })
})
