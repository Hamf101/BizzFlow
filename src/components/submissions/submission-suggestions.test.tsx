import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { SubmissionSuggestions } from "@/components/submissions/submission-suggestions"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { SubmissionSuggestion } from "@/types/submission-review"

vi.mock("@/app/(dashboard)/submissions/actions", () => ({ decideSuggestionAction: vi.fn() }))

const SUBMITTER = "20000000-0000-4000-8000-000000000001"
const MANAGER = "20000000-0000-4000-8000-000000000002"
const at = "2026-07-18T17:00:00.000Z"

const submission = (status: Submission["status"]): Submission =>
  ({
    createdBy: SUBMITTER,
    id: "s1",
    status,
    templateSnapshot: { blocks: [{ fieldKey: "total", id: "b1", label: "Total", type: "text_field" }] },
  }) as unknown as Submission
const suggestion = (status: SubmissionSuggestion["status"], proposedValue: string | boolean = "120"): SubmissionSuggestion => ({
  decidedAt: status === "pending" ? null : at,
  decidedBy: status === "pending" ? null : SUBMITTER,
  fieldKey: "total",
  id: `g-${status}`,
  previousValue: "100",
  proposedValue,
  status,
  suggestedAt: at,
  suggestedBy: MANAGER,
})
const members = [{ email: "m@example.test", fullName: "Maya Manager", userId: MANAGER }] as OrganizationMember[]
const render = (viewer: string, status: Submission["status"], suggestions: SubmissionSuggestion[]) =>
  renderToStaticMarkup(<SubmissionSuggestions currentUserId={viewer} members={members} submission={submission(status)} suggestions={suggestions} />)

describe("SubmissionSuggestions", () => {
  it("shows the answer's label, what it was, what was suggested and by whom, and lets only the submitter decide", () => {
    const mine = render(SUBMITTER, "in_review", [suggestion("pending")])
    const theirs = render(MANAGER, "in_review", [suggestion("pending")])

    expect(mine).toContain("Total")
    expect(mine).toContain("100")
    expect(mine).toContain("120")
    expect(mine).toContain("Maya Manager")
    expect(mine).toContain("Accept")
    expect(theirs).toContain("Waiting")
    expect(theirs).not.toContain("Accept")
  })

  it("keeps decided suggestions as the trail, and an undecided one once the review is over reads as not decided", () => {
    const html = render(SUBMITTER, "approved", [suggestion("accepted"), suggestion("declined", true), suggestion("pending")])

    expect(html).toContain("Accepted")
    expect(html).toContain("Declined")
    expect(html).toContain("Ticked")
    expect(html).toContain("Not decided")
    expect(html).not.toContain("Accept<")
  })

  it("draws nothing when nothing was suggested", () => {
    expect(render(SUBMITTER, "in_review", [])).toBe("")
  })
})
