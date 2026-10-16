// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import {
  submissionListState,
  type SubmissionListView,
} from "@/components/submissions/submission-list-view"
import { SubmissionsWorkspace } from "@/components/submissions/submissions-workspace"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const VIEWER_ID = "20000000-0000-4000-8000-000000000001"
const MARA_ID = "20000000-0000-4000-8000-000000000002"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const SUBMISSION_ID = "40000000-0000-4000-8000-000000000001"
const SECOND_SUBMISSION_ID = "40000000-0000-4000-8000-000000000002"

const mara: OrganizationMember = {
  createdAt: "2026-07-01T12:00:00.000Z",
  email: "mara@example.test",
  fullName: "Mara Bell",
  id: "membership-mara",
  role: "manager",
  status: "active",
  userId: MARA_ID,
}

function createSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    assignedAt: null,
    assignedBy: null,
    assignedTo: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: VIEWER_ID,
    id: SUBMISSION_ID,
    organizationId: ORG_ID,
    revision: 1,
    status: "draft",
    submittedAt: null,
    submittedBy: null,
    templateId: TEMPLATE_ID,
    templateRevision: 1,
    templateSnapshot: {} as Submission["templateSnapshot"],
    title: "Vendor intake",
    updatedAt: "2026-09-02T09:00:00.000Z",
    updatedBy: VIEWER_ID,
    values: {},
    ...overrides,
  } as Submission
}

const inReview = createSubmission({
  assignedAt: "2026-09-03T09:00:00.000Z",
  assignedBy: VIEWER_ID,
  assignedTo: MARA_ID,
  id: SECOND_SUBMISSION_ID,
  status: "in_review",
  submittedAt: "2026-09-02T12:00:00.000Z",
  submittedBy: VIEWER_ID,
  title: "Lease renewal",
})

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

function renderWorkspace(
  overrides: Partial<{
    canAssign: boolean
    canCreate: boolean
    submissions: Submission[]
    total: number
    view: SubmissionListView
  }> = {}
): void {
  const submissions = overrides.submissions ?? [createSubmission(), inReview]

  render(
    <SubmissionsWorkspace
      canAssign={overrides.canAssign ?? true}
      canCreate={overrides.canCreate ?? true}
      currentUserId={VIEWER_ID}
      members={[mara]}
      organizationId={ORG_ID}
      savedViews={[]}
      submissions={submissions}
      total={overrides.total ?? submissions.length}
      view={overrides.view ?? submissionListState.parse({})}
    />
  )
}

describe("SubmissionsWorkspace", () => {
  it("shows the words the view is narrowed to, and clears only them", () => {
    renderWorkspace({
      view: submissionListState.parse({
        page: "2",
        q: "old",
        size: "25",
        status: "draft",
      }),
    })

    const chip = document.querySelector('[data-slot="list-query"]')

    expect(chip?.textContent).toContain("Matching “old”")
    expect(chip?.getAttribute("href")).toBe("/submissions?status=draft&size=25")
  })

  it("says where an answer came from: a link sent to one person, or a public link anyone could open", () => {
    renderWorkspace({
      submissions: [
        createSubmission({ fromPublicLink: true, sentTo: "jordan@example.test", title: "Quote" }),
        createSubmission({ fromPublicLink: true, id: SECOND_SUBMISSION_ID, title: "Quote" }),
      ],
    })

    expect([...document.querySelectorAll('[data-slot="submission-source"]')].map((line) => line.textContent)).toEqual([
      "Sent to jordan@example.test",
      "From a public link",
    ])
  })

  it("shows the assignee only to people who assign reviews", () => {
    renderWorkspace({ canAssign: false })

    expect(document.querySelector('[data-slot="submission-assignee"]')).toBeNull()
    expect(
      [...document.querySelectorAll('[role="columnheader"]')].map(
        (header: Element) => header.textContent
      )
    ).toEqual(["Submission", "Progress", "Updated"])
  })

  it("offers a new submission only to members who can start one", () => {
    renderWorkspace()

    expect(
      document.querySelector('a[href="/submissions/new"]')?.textContent
    ).toBe("New submission")

    renderWorkspace({ canCreate: false })

    expect(document.querySelector('a[href="/submissions/new"]')).toBeNull()
  })

  it("tells an empty list from a view that matches nothing", () => {
    renderWorkspace({ submissions: [], total: 0 })

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "No submissions yet."
    )
    expect(document.querySelector('[role="table"]')).toBeNull()

    renderWorkspace({
      submissions: [],
      total: 0,
      view: submissionListState.parse({ q: "lease" }),
    })

    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "No submissions match this view."
    )
  })
})
