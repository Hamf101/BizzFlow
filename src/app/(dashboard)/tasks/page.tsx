import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { taskListState } from "@/components/tasks/task-list-view"
import {
  listInternalTaskMembers,
  TaskPageShell,
} from "@/components/tasks/task-presentation"
import {
  TasksWorkspace,
  type TaskListItem,
} from "@/components/tasks/tasks-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getLastPage, type RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listOrganizationPeople } from "@/services/organization-service"
import { listTaskPage, type TaskPage } from "@/services/task-service"
import type { OrganizationMember } from "@/types/organization"
import { isTerminalTaskStatus, type Task } from "@/types/task"

import { createTaskAction } from "./actions"

type TasksSearchParams = Promise<RawSearchParams>

/**
 * Lists one page of the organization's tasks, searched, filtered, sorted, and
 * paged by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns Tenant task workspace, or a user-safe access or load failure.
 */
export default async function TasksPage({
  searchParams,
}: {
  searchParams: TasksSearchParams
}): Promise<ReactElement> {
  const query = await searchParams
  const user = await loadAuthenticatedPageUser("/tasks")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "tasks_context_load_failed",
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <TaskPageShell>
          <Alert variant="destructive">
            <AlertTitle>Tasks unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </TaskPageShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const context = contextResult.context
  const canView = canPerformOrganizationAction(
    context.membership,
    "tasks:view"
  )

  if (!canView) {
    return (
      <TaskPageShell>
        <Alert variant="destructive">
          <AlertTitle>Tasks are not shared with your role</AlertTitle>
          <AlertDescription>
            Ask an owner or manager for access if you need to track work for{" "}
            {context.organization.name}.
          </AlertDescription>
        </Alert>
      </TaskPageShell>
    )
  }

  const view = taskListState.parse(query)
  const [result, members] = await Promise.all([
    listTaskPage({
      actorUserId: user.id,
      assignedTo: view.filters.assignee,
      organizationId: context.organization.id,
      page: view.page,
      pageSize: view.pageSize,
      query: view.query || undefined,
      sort: view.sort,
      statuses: view.filters.status ? [view.filters.status] : undefined,
    })
      .then((taskPage: TaskPage) => ({ errorMessage: null, taskPage }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(error, "Unable to load tasks.")
        console.warn("tasks_list_load_failed", {
          organizationId: context.organization.id,
          reason: errorMessage,
          userId: user.id,
        })
        return { errorMessage, taskPage: null }
      }),
    listOrganizationPeople(user.id, context.organization.id)
      .then((people) => people.members)
      .catch((error: unknown) => {
        console.warn("tasks_people_load_failed", {
          organizationId: context.organization.id,
          reason: getPageErrorMessage(error, "Unable to load member names."),
          userId: user.id,
        })
        return [] as OrganizationMember[]
      }),
  ])

  if (result.taskPage === null) {
    return (
      <TaskPageShell>
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          Tasks
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Task list unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </TaskPageShell>
    )
  }

  const lastPage = getLastPage(result.taskPage.total, view.pageSize)

  // A stale link past the end opens the last page that still has tasks.
  if (view.page > lastPage) {
    redirect(taskListState.href("/tasks", view, { page: lastPage }))
  }

  return (
    <TaskPageShell>
      <TasksWorkspace
        canAssign={canPerformOrganizationAction(
          context.membership,
          "tasks:assign"
        )}
        canCreate={canPerformOrganizationAction(
          context.membership,
          "tasks:create"
        )}
        createTaskAction={createTaskAction}
        currentUserId={user.id}
        internalMembers={listInternalTaskMembers(members)}
        items={toTaskListItems(result.taskPage.tasks)}
        members={members}
        total={result.taskPage.total}
        view={view}
      />
    </TaskPageShell>
  )
}

// The overdue flag is read once while the page loads its data, so rendering
// stays a pure function of the props it was handed.
function toTaskListItems(tasks: Task[]): TaskListItem[] {
  const nowMs = Date.now()

  return tasks.map(
    (task: Task): TaskListItem => ({
      overdue:
        task.dueAt !== null &&
        !isTerminalTaskStatus(task.status) &&
        Date.parse(task.dueAt) < nowMs,
      task,
    })
  )
}
