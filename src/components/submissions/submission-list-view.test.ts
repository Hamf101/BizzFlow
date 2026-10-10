import { describe, expect, it } from "vitest"

import {
  getSubmissionViewAssignee,
  getSubmissionViewMenuSections,
  getSubmissionViewStatuses,
  isSubmissionViewAdjusted,
  submissionListState,
} from "@/components/submissions/submission-list-view"
import type { OrganizationMember } from "@/types/organization"

const MARA_ID = "20000000-0000-4000-8000-000000000002"

const mara: OrganizationMember = {
  createdAt: "2026-07-01T12:00:00.000Z",
  email: "mara@example.test",
  fullName: "Mara Bell",
  id: "membership-mara",
  role: "manager",
  status: "active",
  userId: MARA_ID,
}

// Page 3 of a searched, re-ordered list with a smaller page size.
const view = submissionListState.parse({
  page: "3",
  q: "lease",
  size: "25",
  sort: "title",
})

describe("submission list view", () => {
  it("reads a status group as the lifecycle states it stands for", () => {
    expect(
      getSubmissionViewStatuses(submissionListState.parse({ status: "decided" }))
    ).toEqual(["approved", "rejected", "completed"])
    expect(
      getSubmissionViewStatuses(
        submissionListState.parse({ status: "needs_changes" })
      )
    ).toEqual(["needs_changes"])
    expect(getSubmissionViewStatuses(submissionListState.parse({}))).toBeUndefined()
    // A lifecycle state that is not a pill of its own opens the default view.
    expect(
      getSubmissionViewStatuses(submissionListState.parse({ status: "approved" }))
    ).toBeUndefined()
  })

  it("reads the assignee filter as a user id, unassigned, or anyone", () => {
    expect(
      getSubmissionViewAssignee(submissionListState.parse({ assignee: MARA_ID }))
    ).toBe(MARA_ID)
    expect(
      getSubmissionViewAssignee(
        submissionListState.parse({ assignee: "unassigned" })
      )
    ).toBeNull()
    expect(getSubmissionViewAssignee(submissionListState.parse({}))).toBeUndefined()
    expect(
      getSubmissionViewAssignee(submissionListState.parse({ assignee: "someone" }))
    ).toBeUndefined()
  })

  it("gives people who assign reviews sort, assignee, and export options", () => {
    const sections = getSubmissionViewMenuSections(view, [mara], {
      canFilterAssignee: true,
    })

    expect(sections.map((section) => section.label)).toEqual([
      "Sort",
      "Assignee",
      "Export",
    ])
    expect(sections[1].options).toEqual([
      { href: "/submissions?q=lease&sort=title&size=25", label: "Anyone", selected: true },
      {
        href: "/submissions?assignee=unassigned&q=lease&sort=title&size=25",
        label: "Unassigned",
        selected: false,
      },
      {
        href: `/submissions?assignee=${MARA_ID}&q=lease&sort=title&size=25`,
        label: "Mara Bell",
        selected: false,
      },
    ])
    // The export follows the view but never a page of it.
    expect(sections[2].options).toEqual([
      {
        download: true,
        href: "/api/export/submissions?q=lease&sort=title",
        label: "Download CSV",
        selected: false,
      },
    ])
  })

  it("keeps everyone else to sort and export", () => {
    expect(
      getSubmissionViewMenuSections(view, [mara], {
        canFilterAssignee: false,
      }).map((section) => section.label)
    ).toEqual(["Sort", "Export"])
  })

  it("says when a setting that only the view menu shows differs from the default", () => {
    expect(isSubmissionViewAdjusted(submissionListState.parse({}))).toBe(false)
    expect(
      isSubmissionViewAdjusted(
        submissionListState.parse({ q: "lease", status: "draft" })
      )
    ).toBe(false)
    expect(
      isSubmissionViewAdjusted(
        submissionListState.parse({ assignee: "unassigned" })
      )
    ).toBe(true)
    expect(isSubmissionViewAdjusted(submissionListState.parse({ sort: "title" }))).toBe(
      true
    )
    expect(isSubmissionViewAdjusted(submissionListState.parse({ size: "25" }))).toBe(
      true
    )
  })
})
