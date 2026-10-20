import Link from "next/link"
import type { ReactElement } from "react"

import { ListFilterChips } from "@/components/data/list-filter-chips"
import { ListPagination } from "@/components/data/list-pagination"
import { ListQuery } from "@/components/data/list-query"
import { ListEmpty, ListHeading } from "@/components/data/list-heading"
import { type ListSavedViews, ListViewMenu } from "@/components/data/list-view-menu"
import { formatMemberName } from "@/components/people/member-name"
import { NewTaskDialog } from "@/components/tasks/new-task-dialog"
import {
  getTaskStatusOptions,
  getTaskViewMenuSections,
  isTaskViewAdjusted,
  taskListState,
  type TaskListView,
} from "@/components/tasks/task-list-view"
import { TaskStatusBadge } from "@/components/tasks/task-presentation"
import { LocalDate } from "@/components/ui/local-date"
import { cn } from "@/lib/utils"
import type { OrganizationMember } from "@/types/organization"
import type { Task } from "@/types/task"

/** One task row, with its overdue flag worked out while the page loads. */
export type TaskListItem = {
  overdue: boolean
  task: Task
}

const TASK_GRID =
  "lg:grid-cols-[minmax(14rem,1.6fr)_minmax(7rem,.6fr)_minmax(9rem,.8fr)_minmax(8rem,.7fr)]"

/**
 * Renders the Tasks workspace in the People pattern: a quiet front with
 * search, status pills, and name-first rows, and every other tool — order,
 * assignee, new task — kept behind a button until it is wanted.
 *
 * @param props - The current view, its page of tasks, members, and create access.
 * @returns The Tasks workspace.
 */
export function TasksWorkspace({
  canAssign,
  canCreate,
  createTaskAction,
  currentUserId,
  internalMembers,
  items,
  members,
  savedViews,
  total,
  view,
}: {
  canAssign: boolean
  canCreate: boolean
  createTaskAction: (formData: FormData) => Promise<void>
  currentUserId: string
  internalMembers: OrganizationMember[]
  items: TaskListItem[]
  members: OrganizationMember[]
  savedViews: ListSavedViews["saved"]
  total: number
  view: TaskListView
}): ReactElement {

  const listViews: ListSavedViews = {
    list: "tasks",
    query: taskListState.toSearchParams({ ...view, page: 1 }).toString(),
    saved: savedViews,
  }

  return (
    <section className="flex flex-col gap-5" data-slot="tasks-workspace">
      <div className="flex items-center justify-between gap-3">
        <ListHeading noun={["task", "tasks"]} title="Tasks" total={total} views={listViews} />
        <div className="flex shrink-0 gap-2">
          <ListViewMenu
            adjusted={isTaskViewAdjusted(view)}
            label="View options"
            sections={getTaskViewMenuSections(view, internalMembers)}
            views={listViews}
          />
          {canCreate ? (
            <NewTaskDialog
              canAssign={canAssign}
              createTaskAction={createTaskAction}
              members={internalMembers}
            />
          ) : null}
        </div>
      </div>

      {view.query ? (
        <ListQuery
          clearHref={taskListState.href("/tasks", view, { query: "" })}
          query={view.query}
        />
      ) : null}

      <ListFilterChips
        label="Filter tasks by status"
        options={getTaskStatusOptions(view)}
      />

      {items.length === 0 ? (
        <ListEmpty>
          {view.query || view.filters.status || view.filters.assignee
            ? "No tasks match this view."
            : "No tasks yet."}
        </ListEmpty>
      ) : (
        <div
          aria-label="Tasks"
          className="flex flex-col gap-1"
          data-slot="task-directory"
          role="table"
        >
          <div
            className={cn(
              "hidden gap-4 px-3 py-2 text-xs font-normal text-muted-foreground lg:grid",
              TASK_GRID
            )}
            role="row"
          >
            <span role="columnheader">Task</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Assignee</span>
            <span role="columnheader">Due</span>
          </div>
          {items.map((item: TaskListItem) => (
            <TaskRow
              currentUserId={currentUserId}
              item={item}
              key={item.task.id}
              members={members}
            />
          ))}
        </div>
      )}

      <ListPagination
        href={(page) => taskListState.href("/tasks", view, { page })}
        page={view.page}
        pageSize={view.pageSize}
        total={total}
      />
    </section>
  )
}

function TaskRow({
  currentUserId,
  item,
  members,
}: {
  currentUserId: string
  item: TaskListItem
  members: OrganizationMember[]
}): ReactElement {
  const { overdue, task } = item

  return (
    <div
      className={cn(
        "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-card/65 lg:gap-4 lg:px-3",
        TASK_GRID
      )}
      data-slot="task-row"
      role="row"
    >
      <div className="flex min-w-0 flex-col gap-0.5" role="cell">
        <Link
          className="w-fit max-w-full truncate rounded-sm text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/35"
          href={`/tasks/${encodeURIComponent(task.id)}`}
        >
          {task.title}
        </Link>
        <TaskDue
          className="text-xs lg:hidden"
          dueAt={task.dueAt}
          overdue={overdue}
          slot="task-due-compact"
        />
      </div>
      <div
        className="justify-self-end lg:justify-self-start"
        data-slot="task-status"
        role="cell"
      >
        <TaskStatusBadge status={task.status} />
      </div>
      <span
        className="hidden truncate text-sm text-muted-foreground lg:block"
        data-slot="task-assignee"
        role="cell"
      >
        {formatMemberName(task.assignedTo, members, currentUserId)}
      </span>
      <div className="hidden lg:block" role="cell">
        <TaskDue
          className="text-sm"
          dueAt={task.dueAt}
          overdue={overdue}
          slot="task-due"
        />
      </div>
    </div>
  )
}

function TaskDue({
  className,
  dueAt,
  overdue,
  slot,
}: {
  className: string
  dueAt: string | null
  overdue: boolean
  slot: string
}): ReactElement {
  if (!dueAt) {
    return (
      <span className={cn("text-muted-foreground", className)} data-slot={slot}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">No due date</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        "text-muted-foreground tabular-nums",
        overdue && "text-destructive",
        className
      )}
      data-slot={slot}
    >
      {/* Said in words, not only in red. */}
      {overdue ? "Overdue · " : null}
      <LocalDate value={dueAt} />
    </span>
  )
}
