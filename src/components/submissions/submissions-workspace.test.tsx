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
      submissions={submissions}
      total={overrides.total ?? submissions.length}
      view={overrides.view ?? submissionListState.parse({})}
    />
  )
}

function readCells(slot: string): Array<string | null | undefined> {
  return [...document.querySelectorAll('[data-slot="submission-row"]')].map(
    (row: Element): string | null | undefined =>
      row.querySelector(`[data-slot="${slot}"]`)?.textContent
  )
}

describe("SubmissionsWorkspace", () => {
  it("leads with the title and count, one search, and the status pills", () => {
    renderWorkspace({ total: 12 })

    expect(document.querySelector("h1")?.textContent).toBe("Submissions 12")
    expect(
      document.querySelector("h1 span")?.getAttribute("aria-label")
    ).toBe("12 submissions")
    expect(
      document.querySelector('input[type="search"]')?.getAttribute("aria-label")
    ).toBe("Search submissions")
    expect(
      document.querySelector('nav[aria-label="Filter submissions by status"]')
        ?.textContent
    ).toBe("AllDraftsSubmittedIn reviewNeeds changesDecided")
    expect(document.body.textContent).not.toContain("Review inbox")
  })

  it("carries the rest of the view into a new search", () => {
    renderWorkspace({
      view: submissionListState.parse({
        page: "2",
        q: "old",
        size: "25",
        status: "draft",
      }),
    })

    const form = document.querySelector('form[role="search"]')

    expect(form?.getAttribute("action")).toBe("/submissions")
    expect(
      [...(form?.querySelectorAll('input[type="hidden"]') ?? [])].map(
        (input: Element) => [input.getAttribute("name"), input.getAttribute("value")]
      )
    ).toEqual([
      ["status", "draft"],
      ["size", "25"],
    ])
    expect(form?.querySelector('input[name="q"]')?.getAttribute("value")).toBe("old")
  })

  it("lists each submission by its title, linked to it, with its status and assignee", () => {
    renderWorkspace()

    const links = [
      ...document.querySelectorAll('[data-slot="submission-row"] a'),
    ]

    expect(links.map((link: Element) => link.textContent)).toEqual([
      "Vendor intake",
      "Lease renewal",
    ])
    expect(links[1]?.getAttribute("href")).toBe(
      `/submissions/${SECOND_SUBMISSION_ID}`
    )
    expect(readCells("submission-status")).toEqual(["Draft", "In review"])
    expect(readCells("submission-assignee")).toEqual(["Unassigned", "Mara Bell"])
  })

  it("shows the assignee only to people who assign reviews", () => {
    renderWorkspace({ canAssign: false })

    expect(document.querySelector('[data-slot="submission-assignee"]')).toBeNull()
    expect(
      [...document.querySelectorAll('[role="columnheader"]')].map(
        (header: Element) => header.textContent
      )
    ).toEqual(["Submission", "Status", "Updated"])
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

  it("pages with the rest of the view kept in each link, and no link past either end", () => {
    const readPagination = (page: string): Array<string | null | undefined> => {
      renderWorkspace({
        total: 120,
        view: submissionListState.parse({ page, q: "lease" }),
      })
      const pagination = document.querySelector('nav[aria-label="Pagination"]')

      return [
        pagination?.textContent,
        pagination?.querySelector('a[rel="prev"]')?.getAttribute("href"),
        pagination?.querySelector('a[rel="next"]')?.getAttribute("href"),
      ]
    }

    expect(readPagination("1")).toEqual([
      expect.stringContaining("1–50 of 120"),
      undefined,
      "/submissions?q=lease&page=2",
    ])
    expect(readPagination("2")).toEqual([
      expect.stringContaining("51–100 of 120"),
      "/submissions?q=lease",
      "/submissions?q=lease&page=3",
    ])
    expect(readPagination("3")).toEqual([
      expect.stringContaining("101–120 of 120"),
      "/submissions?q=lease&page=2",
      undefined,
    ])
  })
})
