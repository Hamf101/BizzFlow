import { z } from "zod"

import type {
  ListOption,
  ListOptionSection,
} from "@/components/data/list-option"
import { getTaskStatusLabel } from "@/components/tasks/task-presentation"
import {
  defineListState,
  formatListSort,
  type ListSort,
} from "@/lib/list-state"
import type { OrganizationMember } from "@/types/organization"
import {
  TASK_SEARCH_MAX_LENGTH,
  TASK_SORT_KEYS,
  TASK_STATUSES,
  taskStatusSchema,
  type TaskSortKey,
} from "@/types/task"

const TASKS_PATH = "/tasks"

/** The Tasks page's URL state; unknown or stale values open the default view. */
export const taskListState = defineListState({
  filters: {
    assignee: z.string().uuid(),
    status: taskStatusSchema,
  },
  pageSizes: [50, 25, 100],
  search: { maxLength: TASK_SEARCH_MAX_LENGTH },
  sort: {
    default: { direction: "asc", key: "due" },
    keys: TASK_SORT_KEYS,
  },
})

/** One validated Tasks view. */
export type TaskListView = ReturnType<typeof taskListState.parse>

const DEFAULT_TASK_VIEW = taskListState.parse({})

const TASK_SORT_OPTIONS: ReadonlyArray<{
  label: string
  sort: ListSort<TaskSortKey>
}> = [
  { label: "Due date, soonest first", sort: { direction: "asc", key: "due" } },
  { label: "Due date, latest first", sort: { direction: "desc", key: "due" } },
  { label: "Newest first", sort: { direction: "desc", key: "created" } },
  { label: "Oldest first", sort: { direction: "asc", key: "created" } },
  { label: "Title, A to Z", sort: { direction: "asc", key: "title" } },
  { label: "Title, Z to A", sort: { direction: "desc", key: "title" } },
]

/**
 * Lists the status pills, each a link that keeps the rest of the view.
 *
 * @param view - Current Tasks view.
 * @returns "All" followed by one option per task status.
 */
export function getTaskStatusOptions(view: TaskListView): ListOption[] {
  return [
    {
      href: taskListState.href(TASKS_PATH, view, {
        filters: { status: undefined },
      }),
      label: "All",
      selected: view.filters.status === undefined,
    },
    ...TASK_STATUSES.map(
      (status): ListOption => ({
        href: taskListState.href(TASKS_PATH, view, { filters: { status } }),
        label: getTaskStatusLabel(status),
        selected: view.filters.status === status,
      })
    ),
  ]
}

/**
 * Lists the settings kept behind the view menu: order and assignee.
 *
 * @param view - Current Tasks view.
 * @param members - Members a task can be assigned to.
 * @returns The Sort and Assignee sections.
 */
export function getTaskViewMenuSections(
  view: TaskListView,
  members: readonly OrganizationMember[]
): ListOptionSection[] {
  return [
    {
      label: "Sort",
      options: TASK_SORT_OPTIONS.map(
        ({ label, sort }): ListOption => ({
          href: taskListState.href(TASKS_PATH, view, { sort }),
          label,
          selected: formatListSort(view.sort) === formatListSort(sort),
        })
      ),
    },
    {
      label: "Assignee",
      options: [
        {
          href: taskListState.href(TASKS_PATH, view, {
            filters: { assignee: undefined },
          }),
          label: "Anyone",
          selected: view.filters.assignee === undefined,
        },
        ...members.map(
          (member: OrganizationMember): ListOption => ({
            href: taskListState.href(TASKS_PATH, view, {
              filters: { assignee: member.userId },
            }),
            label: member.fullName?.trim() || member.email,
            selected: view.filters.assignee === member.userId,
          })
        ),
      ],
    },
  ]
}

/**
 * Reports whether a setting that only the view menu shows differs from the
 * default, so the menu can say so.
 *
 * @param view - Current Tasks view.
 * @returns True when the assignee, order, or page size is not the default.
 */
export function isTaskViewAdjusted(view: TaskListView): boolean {
  return (
    view.filters.assignee !== undefined ||
    formatListSort(view.sort) !== formatListSort(DEFAULT_TASK_VIEW.sort) ||
    view.pageSize !== DEFAULT_TASK_VIEW.pageSize
  )
}

/**
 * Lists the fields a new search carries over: everything except the old
 * query and the page, so the search starts on page one of the same view.
 *
 * @param view - Current Tasks view.
 * @returns Name and value pairs for hidden form fields.
 */
export function getTaskSearchFields(
  view: TaskListView
): Array<[name: string, value: string]> {
  return Array.from(
    taskListState.toSearchParams({ ...view, page: 1, query: "" }).entries()
  )
}
