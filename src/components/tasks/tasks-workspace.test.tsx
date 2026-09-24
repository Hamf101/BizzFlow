// @vitest-environment jsdom

import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { taskListState } from "@/components/tasks/task-list-view"
import type { OrganizationMember } from "@/types/organization"
import type { Task } from "@/types/task"

import { TasksWorkspace, type TaskListItem } from "./tasks-workspace"

// The search box moves to the searched list through the router; rendering it
// to markup only needs the hook to answer.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const VIEWER_ID = "20000000-0000-4000-8000-000000000001"
const MARA_ID = "20000000-0000-4000-8000-000000000002"
const TASK_ID = "30000000-0000-4000-8000-000000000001"
const SECOND_TASK_ID = "30000000-0000-4000-8000-000000000002"
const CREATED_AT = "2026-09-01T09:00:00.000Z"

const mara: OrganizationMember = {
  createdAt: CREATED_AT,
  email: "mara@example.test",
  fullName: "Mara Bell",
  id: "membership-mara",
  role: "staff",
  status: "active",
  userId: MARA_ID,
}

function createTask(overrides: Partial<Task>): Task {
  return {
    assignedAt: null,
    assignedBy: null,
    assignedTo: null,
    completedAt: null,
    createdAt: CREATED_AT,
    createdBy: VIEWER_ID,
    description: null,
    dueAt: null,
    id: TASK_ID,
    organizationId: ORG_ID,
    revision: 1,
    status: "open",
    submissionId: null,
    title: "Chase references",
    updatedAt: CREATED_AT,
    updatedBy: VIEWER_ID,
    ...overrides,
  } as Task
}

async function createTaskAction(): Promise<void> {}

afterEach(() => {
  document.body.replaceChildren()
})

function render(ui: ReactElement): void {
  document.body.innerHTML = renderToStaticMarkup(ui)
}

function renderWorkspace(
  items: TaskListItem[],
  params: Record<string, string> = {}
): void {
  render(
    <TasksWorkspace
      canAssign
      canCreate
      createTaskAction={createTaskAction}
      currentUserId={VIEWER_ID}
      internalMembers={[mara]}
      items={items}
      members={[mara]}
      savedViews={[]}
      total={items.length}
      view={taskListState.parse(params)}
    />
  )
}

function readRows(): Array<Record<string, string | null | undefined>> {
  return Array.from(document.querySelectorAll('[data-slot="task-row"]')).map(
    (row) => ({
      assignee: row.querySelector('[data-slot="task-assignee"]')?.textContent,
      due: row.querySelector('[data-slot="task-due"]')?.textContent,
      href: row.querySelector("a")?.getAttribute("href"),
      status: row.querySelector('[data-slot="task-status"]')?.textContent,
      title: row.querySelector("a")?.textContent,
    })
  )
}

describe("TasksWorkspace", () => {
  it("lists name-first rows with status, assignee, and due date, and marks overdue work", () => {
    renderWorkspace([
      {
        overdue: true,
        task: createTask({
          assignedAt: CREATED_AT,
          assignedBy: VIEWER_ID,
          assignedTo: MARA_ID,
          // Midday UTC keeps the rendered date stable across test timezones.
          dueAt: "2026-09-10T12:00:00.000Z",
        }),
      },
      {
        overdue: false,
        task: createTask({ id: SECOND_TASK_ID, title: "Renew insurance" }),
      },
    ])

    expect(document.querySelector("h1")?.textContent).toBe("Tasks 2")
    expect(readRows()).toEqual([
      {
        assignee: "Mara Bell",
        due: "Overdue Sep 10, 2026",
        href: `/tasks/${TASK_ID}`,
        status: "Open",
        title: "Chase references",
      },
      {
        assignee: "Unassigned",
        due: "—No due date",
        href: `/tasks/${SECOND_TASK_ID}`,
        status: "Open",
        title: "Renew insurance",
      },
    ])
  })

  it.each([
    ["an unfiltered list", {}, "No tasks yet."],
    ["a search", { q: "lease" }, "No tasks match this view."],
    ["a status filter", { status: "completed" }, "No tasks match this view."],
  ])("says so plainly when %s is empty", (_case, params, message) => {
    renderWorkspace([], params)

    expect(document.querySelector('[role="status"]')?.textContent).toBe(message)
    expect(document.querySelectorAll('[data-slot="task-row"]')).toHaveLength(0)
  })
})
