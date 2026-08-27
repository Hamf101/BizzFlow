import { CalendarClock, ListChecks, Plus, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"
import { z } from "zod"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatMediumDateTime } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listOrganizationPeople } from "@/services/organization-service"
import { listTasks } from "@/services/task-service"
import type { OrganizationMember } from "@/types/organization"
import {
  isTerminalTaskStatus,
  TASK_STATUSES,
  taskStatusSchema,
  type Task,
} from "@/types/task"

import { createTaskAction } from "./actions"
import {
  formatTaskMemberName,
  getTaskStatusLabel,
  listInternalTaskMembers,
  TaskPageShell,
  TaskStatusBadge,
} from "@/components/tasks/task-presentation"

type TaskListItem = {
  overdue: boolean
  task: Task
}

type TasksSearchParams = Promise<{
  assignee?: string
  error?: string
  message?: string
  status?: string
}>

// Unknown or stale filter values fall back to "no filter" instead of failing
// the page, so a hand-edited or bookmarked URL still renders the workspace.
const taskFiltersSchema = z.object({
  assignee: z.string().uuid().optional().catch(undefined),
  status: taskStatusSchema.optional().catch(undefined),
})

/**
 * Lists the organization's tasks with status and assignee filters.
 *
 * @param props - Filter selection and action feedback in search parameters.
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
        <TaskPageShell feedback={query}>
          <Alert variant="destructive">
            <AlertTitle>Tasks unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </TaskPageShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing tasks.",
      })
    )
  }

  const context = contextResult.context
  const canView = canPerformOrganizationAction(
    context.membership.role,
    "tasks:view"
  )

  if (!canView) {
    return (
      <TaskPageShell feedback={query}>
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

  const canCreate = canPerformOrganizationAction(
    context.membership.role,
    "tasks:create"
  )
  const canAssign = canPerformOrganizationAction(
    context.membership.role,
    "tasks:assign"
  )
  const filters = taskFiltersSchema.parse({
    assignee: query.assignee,
    status: query.status,
  })
  const [result, members] = await Promise.all([
    listTasks({
      actorUserId: user.id,
      assignedTo: filters.assignee,
      organizationId: context.organization.id,
      statuses: filters.status ? [filters.status] : undefined,
    })
      .then((tasks: Task[]) => ({ errorMessage: null as string | null, tasks }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(error, "Unable to load tasks.")
        console.warn("tasks_list_load_failed", {
          organizationId: context.organization.id,
          reason: errorMessage,
          userId: user.id,
        })
        return { errorMessage, tasks: [] as Task[] }
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
  const internalMembers = listInternalTaskMembers(members)

  return (
    <TaskPageShell feedback={query}>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Tasks</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Track follow-up work for {context.organization.name}, assign it to a
          team member, and schedule email reminders.
        </p>
      </section>

      <TaskFilters
        assignee={filters.assignee}
        members={internalMembers}
        status={filters.status}
      />

      {canCreate && (
        <NewTaskPanel canAssign={canAssign} members={internalMembers} />
      )}

      {result.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Task list unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      ) : (
        <TaskList
          currentUserId={user.id}
          filtered={Boolean(filters.assignee || filters.status)}
          items={toTaskListItems(result.tasks)}
          members={members}
        />
      )}
    </TaskPageShell>
  )
}

function TaskFilters({
  assignee,
  members,
  status,
}: {
  assignee: string | undefined
  members: OrganizationMember[]
  status: string | undefined
}): ReactElement {
  const hasFilters = Boolean(assignee || status)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          Filters
        </CardTitle>
        <CardDescription>
          Narrow the list to a lifecycle state, an assignee, or both.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="task-filter-status">Status</FieldLabel>
            <Select
              defaultValue={status ?? ""}
              id="task-filter-status"
              name="status"
            >
              <option value="">Any status</option>
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {getTaskStatusLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field className="sm:flex-1">
            <FieldLabel htmlFor="task-filter-assignee">Assignee</FieldLabel>
            <Select
              defaultValue={assignee ?? ""}
              id="task-filter-assignee"
              name="assignee"
            >
              <option value="">Anyone</option>
              {members.map((member: OrganizationMember) => (
                <option key={member.id} value={member.userId}>
                  {member.fullName?.trim() || member.email}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {hasFilters && (
              <Link
                className={cn(buttonVariants({ variant: "ghost" }))}
                href="/tasks"
              >
                Clear
              </Link>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function NewTaskPanel({
  canAssign,
  members,
}: {
  canAssign: boolean
  members: OrganizationMember[]
}): ReactElement {
  return (
    <Card className="py-0">
      <details className="group/new-task">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-secondary/50 [&::-webkit-details-marker]:hidden">
          <Plus className="size-4 text-muted-foreground" />
          New task
        </summary>
        <div className="border-t border-border p-4">
          <form action={createTaskAction} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="new-task-title">Title</FieldLabel>
              <Input
                id="new-task-title"
                maxLength={200}
                name="title"
                placeholder="Collect the signed lease"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-task-description">
                Description
              </FieldLabel>
              <Textarea
                id="new-task-description"
                maxLength={5_000}
                name="description"
                placeholder="Optional context for whoever picks this up"
              />
            </Field>
            <div className="flex flex-col gap-4 sm:flex-row">
              <Field className="sm:flex-1">
                <FieldLabel htmlFor="new-task-due">Due (UTC)</FieldLabel>
                <Input
                  id="new-task-due"
                  name="dueAt"
                  type="datetime-local"
                />
                <FieldDescription>
                  Optional. An assignee is reminded when this falls due.
                </FieldDescription>
              </Field>
              {canAssign && (
                <Field className="sm:flex-1">
                  <FieldLabel htmlFor="new-task-assignee">Assignee</FieldLabel>
                  <Select
                    defaultValue=""
                    id="new-task-assignee"
                    name="assignedTo"
                  >
                    <option value="">Leave unassigned</option>
                    {members.map((member: OrganizationMember) => (
                      <option key={member.id} value={member.userId}>
                        {member.fullName?.trim() || member.email}
                      </option>
                    ))}
                  </Select>
                  <FieldDescription>
                    The assignee is emailed when the task is handed over.
                  </FieldDescription>
                </Field>
              )}
            </div>
            <Button className="w-fit" type="submit">
              <Plus />
              Create task
            </Button>
          </form>
        </div>
      </details>
    </Card>
  )
}

function TaskList({
  currentUserId,
  filtered,
  items,
  members,
}: {
  currentUserId: string
  filtered: boolean
  items: TaskListItem[]
  members: OrganizationMember[]
}): ReactElement {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {filtered ? "No tasks match these filters" : "No tasks yet"}
          </CardTitle>
          <CardDescription>
            {filtered
              ? "Clear the filters to see every task in this organization."
              : "Tasks capture the follow-up work that keeps a submission moving."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-dashed border-border px-4 py-10 text-center">
            <ListChecks className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              Every task keeps an audit trail of its assignment, status changes,
              and scheduled reminders.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {items.map((item: TaskListItem) => (
        <Card key={item.task.id}>
          <CardHeader>
            <CardTitle className="text-base">{item.task.title}</CardTitle>
            <CardDescription>
              {formatTaskMemberName(
                item.task.assignedTo,
                members,
                currentUserId
              )}
            </CardDescription>
            <CardAction>
              <TaskStatusBadge status={item.task.status} />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            {item.task.description && (
              <p className="line-clamp-2 text-foreground">
                {item.task.description}
              </p>
            )}
            <TaskDueLine item={item} />
          </CardContent>
          <CardFooter>
            <Link
              className={cn(buttonVariants({ variant: "outline" }))}
              href={`/tasks/${encodeURIComponent(item.task.id)}`}
            >
              Open task
            </Link>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function TaskDueLine({ item }: { item: TaskListItem }): ReactElement {
  if (!item.task.dueAt) {
    return <span className="text-xs">No due date</span>
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        item.overdue && "font-medium text-destructive"
      )}
    >
      <CalendarClock className="size-3.5" />
      {item.overdue ? "Overdue " : "Due "}
      {formatMediumDateTime(item.task.dueAt)}
    </span>
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
