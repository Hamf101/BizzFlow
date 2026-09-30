import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { reviewerComments, SubmissionReviewersPanel } from "@/components/submissions/submission-reviewers-panel"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { SubmissionActivityEvent, SubmissionComment, SubmissionReviewer } from "@/types/submission-review"

const OUTSIDER = "20000000-0000-4000-8000-000000000001"
const MANAGER = "20000000-0000-4000-8000-000000000002"
const at = "2026-07-18T17:00:00.000Z"

const comment = (id: string, createdBy: string, body: string): SubmissionComment => ({
  body,
  createdAt: at,
  createdBy,
  id,
  organizationId: "o",
  submissionId: "s",
})
const event = (eventType: SubmissionActivityEvent["eventType"], commentId: string | null): SubmissionActivityEvent => ({
  actorUserId: OUTSIDER,
  assigneeUserId: null,
  commentId,
  createdAt: at,
  eventType,
  fromStatus: "in_review",
  id: `e-${commentId}`,
  organizationId: "o",
  submissionId: "s",
  submissionRevision: 3,
  toStatus: "in_review",
})
const member = (userId: string, fullName: string, role: OrganizationMember["role"]): OrganizationMember =>
  ({ email: `${fullName}@example.test`, fullName, id: userId, role, status: "active", userId }) as OrganizationMember
const reviewer = (userId: string, decision: SubmissionReviewer["decision"], note: string | null = null): SubmissionReviewer => ({
  assignedAt: at,
  assignedBy: MANAGER,
  decidedAt: decision === "pending" ? null : at,
  decision,
  note,
  userId,
})

describe("reviewerComments", () => {
  it("keeps what a reviewer said in the discussion and leaves out the notes that came with a decision", () => {
    const comments = [comment("c1", OUTSIDER, "Looks fine from outside"), comment("c2", OUTSIDER, "Missing page two"), comment("c3", MANAGER, "Noted")]
    const activity = [event("commented", "c1"), event("changes_requested", "c2"), event("commented", "c3")]

    expect(reviewerComments(OUTSIDER, comments, activity).map((entry) => entry.id)).toEqual(["c1"])
    expect(reviewerComments(MANAGER, comments, activity).map((entry) => entry.id)).toEqual(["c3"])
    expect(reviewerComments("someone-else", comments, activity)).toEqual([])
  })
})

describe("SubmissionReviewersPanel", () => {
  const submission = { requiredApprovals: null } as Submission

  it("stops counting a reviewer whose change request was set aside", () => {
    const html = renderToStaticMarkup(
      <SubmissionReviewersPanel
        activity={[]}
        comments={[]}
        members={[member(OUTSIDER, "Olive Outside", "external_reviewer"), member(MANAGER, "Maya Manager", "manager")]}
        reviewers={[reviewer(OUTSIDER, "dismissed", "Not convinced"), reviewer(MANAGER, "pending")]}
        submission={submission}
        tally={{ approved: 0, changesRequested: 0, counting: 1, total: 2 }}
      />
    )

    expect(html).toContain("0 of 1 approval")
    expect(html).toContain("Change request set aside")
  })

  it("lists an external reviewer with their decision and their comments", () => {
    const html = renderToStaticMarkup(
      <SubmissionReviewersPanel
        activity={[event("commented", "c1")]}
        comments={[comment("c1", OUTSIDER, "Looks fine from outside")]}
        members={[member(OUTSIDER, "Olive Outside", "external_reviewer"), member(MANAGER, "Maya Manager", "manager")]}
        reviewers={[reviewer(OUTSIDER, "approved"), reviewer(MANAGER, "pending")]}
        submission={submission}
        tally={{ approved: 1, changesRequested: 0, counting: 2, total: 2 }}
      />
    )

    expect(html).toContain("Olive Outside")
    expect(html).toContain("External reviewer")
    expect(html).toContain("Approved")
    expect(html).toContain("Looks fine from outside")
    expect(html).toContain("1 of 2 approvals")
  })
})
