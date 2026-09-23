import { describe, expect, it } from "vitest"

import { buildQueue, relativeDay, selectDueThisWeek } from "@/components/dashboard/dashboard-view"
import type { AccessibleDocumentSummary } from "@/types/document"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { Task } from "@/types/task"
import { createBlankTemplateContent } from "@/types/template"

const ME = "20000000-0000-4000-8000-000000000001"
const THEO = "20000000-0000-4000-8000-000000000002"
const NOW = new Date("2026-09-16T12:00:00.000Z")
const MEMBERS = [{ email: "theo@example.test", fullName: "Theo Miles", userId: THEO }] as OrganizationMember[]

describe("the dashboard queue", () => {
  it("puts late work first, then reviews and returns oldest first, then signatures, then drafts", () => {
    const queue = buildQueue({
      actorUserId: ME,
      awaitingSignatures: [createDocument("lease", "2026-09-15T09:00:00.000Z")],
      canReview: true,
      members: MEMBERS,
      now: NOW,
      submissions: [
        createSubmission("my-draft", { status: "draft", updatedAt: "2026-09-16T08:00:00.000Z" }),
        createSubmission("theos-draft", { createdBy: THEO, status: "draft" }),
        createSubmission("new-review", { status: "submitted", submittedAt: "2026-09-16T08:00:00.000Z", submittedBy: THEO }),
        createSubmission("old-review", { status: "submitted", submittedAt: "2026-09-13T08:00:00.000Z", submittedBy: THEO }),
        createSubmission("someone-elses-review", { assignedTo: THEO, status: "in_review" }),
        createSubmission("returned", { status: "needs_changes", updatedAt: "2026-09-15T08:00:00.000Z" }),
      ],
      tasks: [
        createTask("late", { dueAt: "2026-09-15T09:00:00.000Z" }),
        createTask("later", { dueAt: "2026-09-18T09:00:00.000Z" }),
        createTask("theos-late", { assignedTo: THEO, dueAt: "2026-09-10T09:00:00.000Z" }),
        createTask("done-late", { completedAt: "2026-09-15T10:00:00.000Z", dueAt: "2026-09-14T09:00:00.000Z", status: "completed" }),
      ],
    })

    expect(queue.map((item) => [item.id, item.when, item.context])).toEqual([
      ["late", "Due yesterday", null],
      ["old-review", "Submitted 3 days ago", "From Theo Miles"],
      ["new-review", "Submitted today", "From Theo Miles"],
      ["returned", "Returned yesterday", null],
      ["lease", "Sent yesterday", null],
      ["my-draft", "Edited today", null],
    ])
  })

  it("leaves reviews to those who may review, and keeps the week ahead to open tasks due within it", () => {
    const submissions = [createSubmission("review", { status: "submitted", submittedAt: "2026-09-16T08:00:00.000Z" })]
    const tasks = [
      createTask("overdue", { dueAt: "2026-09-16T11:00:00.000Z" }),
      createTask("theos-thursday", { assignedTo: THEO, dueAt: "2026-09-17T12:00:00.000Z" }),
      createTask("mine-tuesday", { dueAt: "2026-09-22T12:00:00.000Z" }),
      createTask("next-week", { dueAt: "2026-09-23T12:00:00.000Z" }),
      createTask("cancelled", { dueAt: "2026-09-17T09:00:00.000Z", status: "cancelled" }),
    ]

    expect(
      buildQueue({ actorUserId: ME, awaitingSignatures: [], canReview: false, members: MEMBERS, now: NOW, submissions, tasks: [] })
    ).toEqual([])
    expect(selectDueThisWeek(tasks, MEMBERS, ME, NOW, true).map((task) => [task.id, task.assignee, task.due])).toEqual([
      ["theos-thursday", "Theo Miles", "Thu, Sep 17"],
      ["mine-tuesday", "You", "Tue, Sep 22"],
    ])
    // Someone who cannot hand out tasks has no use for the team's deadlines.
    expect(selectDueThisWeek(tasks, MEMBERS, ME, NOW, false).map((task) => task.id)).toEqual(["mine-tuesday"])
    expect(relativeDay("2026-09-02T12:00:00.000Z", NOW)).toBe("Sep 2")
  })
})

function createTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    assignedAt: "2026-09-01T09:00:00.000Z",
    assignedBy: THEO,
    assignedTo: ME,
    completedAt: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: THEO,
    description: null,
    dueAt: null,
    id,
    organizationId: "10000000-0000-4000-8000-000000000001",
    revision: 1,
    status: "open",
    submissionId: null,
    title: id,
    updatedAt: "2026-09-01T09:00:00.000Z",
    updatedBy: THEO,
    ...overrides,
  } as Task
}

function createSubmission(id: string, overrides: Partial<Submission> = {}): Submission {
  return {
    assignedAt: null,
    assignedBy: null,
    assignedTo: null,
    createdAt: "2026-09-01T09:00:00.000Z",
    createdBy: ME,
    id,
    organizationId: "10000000-0000-4000-8000-000000000001",
    revision: 1,
    status: "draft",
    submittedAt: null,
    submittedBy: null,
    templateId: "30000000-0000-4000-8000-000000000001",
    templateRevision: 1,
    templateSnapshot: createBlankTemplateContent(),
    title: id,
    updatedAt: "2026-09-10T09:00:00.000Z",
    updatedBy: ME,
    values: {},
    ...overrides,
  } as Submission
}

function createDocument(id: string, updatedAt: string): AccessibleDocumentSummary {
  return {
    accessLevel: "contributor",
    archivedAt: null,
    archivedBy: null,
    createdAt: updatedAt,
    createdBy: ME,
    currentVersionId: null,
    description: null,
    folderId: null,
    id,
    lifecycleState: "active",
    organizationId: "10000000-0000-4000-8000-000000000001",
    preTrashLifecycleState: null,
    purgeAfter: null,
    sourceKind: "generated",
    title: id,
    trashedAt: null,
    trashedBy: null,
    trashOperationId: null,
    updatedAt,
    updatedBy: ME,
  }
}
