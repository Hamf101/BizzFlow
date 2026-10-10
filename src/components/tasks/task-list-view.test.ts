import { describe, expect, it } from "vitest"

import {
  getTaskStatusOptions,
  getTaskViewMenuSections,
  isTaskViewAdjusted,
  taskListState,
} from "@/components/tasks/task-list-view"
import type { OrganizationMember } from "@/types/organization"

const MARA_ID = "20000000-0000-4000-8000-000000000002"
const THEO_ID = "20000000-0000-4000-8000-000000000003"

function createMember(
  userId: string,
  fullName: string | null,
  email: string
): OrganizationMember {
  return {
    createdAt: "2026-07-01T12:00:00.000Z",
    email,
    fullName,
    id: `membership-${userId}`,
    role: "staff",
    status: "active",
    userId,
  }
}

// Page 3 of a searched, re-ordered list with a smaller page size.
const view = taskListState.parse({
  page: "3",
  q: "lease",
  size: "25",
  sort: "-title",
})

describe("task list view", () => {
  it("marks only the chosen status", () => {
    expect(
      getTaskStatusOptions(taskListState.parse({ status: "completed" }))
        .filter((option) => option.selected)
        .map((option) => option.label)
    ).toEqual(["Completed"])
  })

  it("keeps the order and the assignee behind the view menu", () => {
    const [sort, assignee] = getTaskViewMenuSections(view, [
      createMember(MARA_ID, "Mara Bell", "mara@example.test"),
      createMember(THEO_ID, null, "theo@example.test"),
    ])

    expect(sort?.label).toBe("Sort")
    expect(sort?.options.map((option) => [option.label, option.selected])).toEqual([
      ["Due date, soonest first", false],
      ["Due date, latest first", false],
      ["Newest first", false],
      ["Oldest first", false],
      ["Title, A to Z", false],
      ["Title, Z to A", true],
    ])
    expect(sort?.options[0]?.href).toBe("/tasks?q=lease&size=25")
    expect(assignee).toEqual({
      label: "Assignee",
      options: [
        { href: "/tasks?q=lease&sort=-title&size=25", label: "Anyone", selected: true },
        {
          href: `/tasks?assignee=${MARA_ID}&q=lease&sort=-title&size=25`,
          label: "Mara Bell",
          selected: false,
        },
        {
          href: `/tasks?assignee=${THEO_ID}&q=lease&sort=-title&size=25`,
          label: "theo@example.test",
          selected: false,
        },
      ],
    })
  })

  it.each([
    ["the default view", {}, false],
    ["a search and a status, which stay visible", { q: "lease", status: "open" }, false],
    ["an assignee", { assignee: MARA_ID }, true],
    ["another order", { sort: "-created" }, true],
    ["another page size", { size: "100" }, true],
  ])("reports whether the view menu holds a change for %s", (_case, params, expected) => {
    expect(isTaskViewAdjusted(taskListState.parse(params))).toBe(expected)
  })
})
