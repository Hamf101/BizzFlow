import {
  ArrowLeft,
  Ban,
  BellOff,
  BellPlus,
  CheckCheck,
  Link2,
  Play,
  RotateCcw,
  Save,
  UserRoundCheck,
} from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ComponentType, ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatMediumDateTime } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listOrganizationPeople } from "@/services/organization-service"
import { getTask, type TaskDetail } from "@/services/task-service"
import type { OrganizationMember } from "@/types/organization"
import {
  isTerminalTaskStatus,
  TASK_STATUS_TRANSITIONS,
  type Task,
  type TaskReminder,
  type TaskStatus,
} from "@/types/task"

import {
  assignTaskAction,
  cancelTaskReminderAction,
  scheduleTaskReminderAction,
  transitionTaskStatusAction,
  updateTaskAction,
} from "../actions"
import {
  formatTaskMemberName,
  getTaskStatusLabel,
  listInternalTaskMembers,
  TASK_SELECT_CLASS_NAME,
  TASK_TEXTAREA_CLASS_NAME,
  TaskPageShell,
  TaskReminderStatusBadge,
  TaskStatusBadge,
} from "@/components/tasks/task-presentation"

type TaskDetailParams = Promise<{ taskId: string }>
type TaskDetailSearchParams = Promise<{
  error?: string
  message?: string
}>

type TaskTransitionPresentation = {
  icon: ComponentType<{ className?: string }>
  label: string
  variant: "default" | "destructive" | "outline"
}

const TASK_TRANSITION_PRESENTATIONS: Record<
  TaskStatus,
  TaskTransitionPresentation
> = {
  open: { icon: RotateCcw, label: "Reopen task", variant: "outline" },
  in_progress: { icon: Play, label: "Start task", variant: "outline" },
  completed: { icon: CheckCheck, label: "Mark complete", variant: "default" },
  cancelled: { icon: Ban, label: "Cancel task", variant: "destructive" },
}

/**
 * Loads one task with its reminders and the controls the viewer may use.
 *
 * @param props - Task path identifier and optional action feedback.
 * @returns Task workspace with lifecycle, assignment, and reminder controls.
 */
export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: TaskDetailParams
  searchParams: TaskDetailSearchParams
}): Promise<ReactElement> {
  const [{ taskId }, query] = await Promise.all([params, searchParams])
  const detailPath = `/tasks/${encodeURIComponent(taskId)}`
  const user = await loadAuthenticatedPageUser(detailPath)
  const contextResult = await loadPageOrganizationContext({
    failureDetails: { taskId },
    failureEvent: "task_detail_context_load_failed",
    userId: user.id,
  })

  if (!contextResult.context) {
    redirect(
      buildRedirect("/tasks", {
        error:
          contextResult.errorMessage ??
          "Create an organization before viewing tasks.",
      })
    )
  }

  const context = contextResult.context

  if (!canPerformOrganizationAction(context.membership.role, "tasks:view")) {
    return (
      <TaskPageShell feedback={query}>
        <Alert variant="destructive">
          <AlertTitle>Tasks are not shared with your role</AlertTitle>
          <AlertDescription>
            Ask an owner or manager for access if you need to track this work.
          </AlertDescription>
        </Alert>
      </TaskPageShell>
    )
  }

  const [result, members] = await Promise.all([
    getTask({
      actorUserId: user.id,
      organizationId: context.organization.id,
      taskId,
    })
      .then((detail: TaskDetail) => ({
        detail,
        errorMessage: null as string | null,
      }))
      .catch((error: unknown) => ({
        detail: null,
        errorMessage: getPageErrorMessage(error, "Unable to load this task."),
      })),
    listOrganizationPeople(user.id, context.organization.id)
      .then((people) => people.members)
      .catch((error: unknown) => {
        console.warn("task_detail_people_load_failed", {
          organizationId: context.organization.id,
          reason: getPageErrorMessage(error, "Unable to load member names."),
          taskId,
          userId: user.id,
        })
        return [] as OrganizationMember[]
      }),
  ])

  if (!result.detail) {
    return (
      <TaskPageShell feedback={query}>
        <BackToTasksLink />
        <Alert variant="destructive">
          <AlertTitle>Task unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </TaskPageShell>
    )
  }

  const task = result.detail.task
  const internalMembers = listInternalTaskMembers(members)
  const closed = isTerminalTaskStatus(task.status)
  // A closed task accepts no further changes, but a reminder left pending
  // against it still can — and should — be cancelled rather than left to fail.
  const canManageReminders = canPerformOrganizationAction(
    context.membership.role,
    "tasks:edit"
  )
  const canEdit = canManageReminders && !closed
  const canAssign =
    canPerformOrganizationAction(context.membership.role, "tasks:assign") &&
    !closed

  return (
    <TaskPageShell feedback={query}>
      <section className="flex flex-col gap-3">
        <BackToTasksLink />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">
            {task.title}
          </h1>
          <TaskStatusBadge status={task.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {formatTaskMemberName(task.assignedTo, members, user.id)} ·{" "}
          {task.dueAt
            ? `Due ${formatMediumDateTime(task.dueAt)}`
            : "No due date"}{" "}
          · Revision {task.revision}
        </p>
        {task.submissionId && (
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "w-fit"
            )}
            href={`/submissions/${encodeURIComponent(task.submissionId)}`}
          >
            <Link2 />
            Linked submission
          </Link>
        )}
      </section>

      {closed && (
        <Alert>
          <AlertTitle>
            {task.status === "completed" ? "Task complete" : "Task cancelled"}
          </AlertTitle>
          <AlertDescription>
            {task.completedAt
              ? `Completed ${formatMediumDateTime(task.completedAt)}. This task is now a read-only record.`
              : "This task is closed and kept as a read-only record."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <TaskLifecyclePanel canEdit={canEdit} task={task} />
          <TaskAssignmentPanel
            canAssign={canAssign}
            currentUserId={user.id}
            members={internalMembers}
            task={task}
          />
          {canEdit && <TaskDetailsPanel task={task} />}
        </div>
        <TaskRemindersPanel
          canCancel={canManageReminders}
          canSchedule={canEdit}
          currentUserId={user.id}
          members={internalMembers}
          reminders={result.detail.reminders}
          task={task}
        />
      </div>
    </TaskPageShell>
  )
}

function BackToTasksLink(): ReactElement {
  return (
    <Link
      className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "w-fit")}
      href="/tasks"
    >
      <ArrowLeft />
      Back to tasks
    </Link>
  )
}

function TaskLifecyclePanel({
  canEdit,
  task,
}: {
  canEdit: boolean
  task: Task
}): ReactElement {
  const transitions = TASK_STATUS_TRANSITIONS[task.status]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <CardDescription>
          Only the moves allowed by the task workflow are offered here.
        </CardDescription>
        <CardAction>
          <TaskStatusBadge status={task.status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        {canEdit && transitions.length > 0 ? (
          <form
            action={transitionTaskStatusAction}
            className="flex flex-wrap gap-2"
          >
            <input name="taskId" type="hidden" value={task.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={task.revision}
            />
            {transitions.map((target: TaskStatus) => {
              const presentation = TASK_TRANSITION_PRESENTATIONS[target]
              const Icon = presentation.icon

              return (
                <Button
                  key={target}
                  name="targetStatus"
                  type="submit"
                  value={target}
                  variant={presentation.variant}
                >
                  <Icon />
                  {presentation.label}
                </Button>
              )
            })}
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {transitions.length === 0
              ? `A ${getTaskStatusLabel(task.status).toLowerCase()} task accepts no further changes.`
              : "You do not have permission to change this task's status."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function TaskAssignmentPanel({
  canAssign,
  currentUserId,
  members,
  task,
}: {
  canAssign: boolean
  currentUserId: string
  members: OrganizationMember[]
  task: Task
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assignment</CardTitle>
        <CardDescription>
          {task.assignedAt
            ? `Handed over ${formatMediumDateTime(task.assignedAt)}.`
            : "Nobody owns this task yet."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canAssign ? (
          <form action={assignTaskAction} className="flex flex-col gap-3">
            <input name="taskId" type="hidden" value={task.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={task.revision}
            />
            <Field>
              <FieldLabel htmlFor="task-assignee">Assignee</FieldLabel>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  className={TASK_SELECT_CLASS_NAME}
                  defaultValue={task.assignedTo ?? ""}
                  id="task-assignee"
                  name="assignedTo"
                >
                  <option value="">Unassigned</option>
                  {members.map((member: OrganizationMember) => (
                    <option key={member.id} value={member.userId}>
                      {member.fullName?.trim() || member.email}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline">
                  <UserRoundCheck />
                  Save
                </Button>
              </div>
              <FieldDescription>
                Choosing a new member emails them the handover.
              </FieldDescription>
            </Field>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {formatTaskMemberName(task.assignedTo, members, currentUserId)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function TaskDetailsPanel({ task }: { task: Task }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Saving checks the revision above, so concurrent edits never overwrite
          each other silently.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateTaskAction} className="flex flex-col gap-4">
          <input name="taskId" type="hidden" value={task.id} />
          <input name="expectedRevision" type="hidden" value={task.revision} />
          <Field>
            <FieldLabel htmlFor="task-title">Title</FieldLabel>
            <Input
              defaultValue={task.title}
              id="task-title"
              maxLength={200}
              name="title"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="task-description">Description</FieldLabel>
            <textarea
              className={TASK_TEXTAREA_CLASS_NAME}
              defaultValue={task.description ?? ""}
              id="task-description"
              maxLength={5_000}
              name="description"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="task-due">Due (UTC)</FieldLabel>
            <Input
              defaultValue={toDateTimeLocalValue(task.dueAt)}
              id="task-due"
              name="dueAt"
              type="datetime-local"
            />
            <FieldDescription>
              Leave empty to remove the due date.
            </FieldDescription>
          </Field>
          <Button className="w-fit" type="submit" variant="outline">
            <Save />
            Save details
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function TaskRemindersPanel({
  canCancel,
  canSchedule,
  currentUserId,
  members,
  reminders,
  task,
}: {
  canCancel: boolean
  canSchedule: boolean
  currentUserId: string
  members: OrganizationMember[]
  reminders: TaskReminder[]
  task: Task
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
        <CardDescription>
          Scheduled email nudges. Each instant is delivered once, even if the
          scheduler runs twice.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reminders are scheduled for this task.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reminders.map((reminder: TaskReminder) => (
              <li
                className="flex flex-wrap items-start justify-between gap-2 rounded-[8px] border border-border bg-muted/30 px-3 py-2"
                key={reminder.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm">
                    {formatMediumDateTime(reminder.remindAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTaskMemberName(
                      reminder.recipientUserId,
                      members,
                      currentUserId
                    )}
                    {` · via ${reminder.channel.toUpperCase()}`}
                    {reminder.origin === "automatic" && " · from the due date"}
                    {reminder.attemptCount > 0 &&
                      ` · ${reminder.attemptCount} attempt${reminder.attemptCount === 1 ? "" : "s"}`}
                  </span>
                  {reminder.lastError && (
                    <span className="text-xs text-destructive">
                      {reminder.lastError}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <TaskReminderStatusBadge status={reminder.status} />
                  {canCancel && reminder.status === "pending" && (
                    <form action={cancelTaskReminderAction}>
                      <input name="taskId" type="hidden" value={task.id} />
                      <input
                        name="reminderId"
                        type="hidden"
                        value={reminder.id}
                      />
                      <Button size="sm" type="submit" variant="ghost">
                        <BellOff />
                        Cancel
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canSchedule && (
          <form
            action={scheduleTaskReminderAction}
            className="flex flex-col gap-4 border-t border-border pt-5"
          >
            <input name="taskId" type="hidden" value={task.id} />
            <Field>
              <FieldLabel htmlFor="reminder-recipient">Recipient</FieldLabel>
              <select
                className={TASK_SELECT_CLASS_NAME}
                defaultValue={task.assignedTo ?? ""}
                id="reminder-recipient"
                name="recipientUserId"
                required
              >
                <option disabled value="">
                  Choose a team member
                </option>
                {members.map((member: OrganizationMember) => (
                  <option key={member.id} value={member.userId}>
                    {member.fullName?.trim() || member.email}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="reminder-channel">Notification Channel</FieldLabel>
              <select
                className={TASK_SELECT_CLASS_NAME}
                defaultValue="email"
                id="reminder-channel"
                name="channel"
                required
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="reminder-remind-at">
                Remind at (UTC)
              </FieldLabel>
              <Input
                id="reminder-remind-at"
                name="remindAt"
                required
                type="datetime-local"
              />
              <FieldDescription>
                Must be in the future. Delivery runs every fifteen minutes.
              </FieldDescription>
            </Field>
            <Button className="w-fit" type="submit" variant="outline">
              <BellPlus />
              Schedule reminder
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function toDateTimeLocalValue(value: string | null): string {
  return value ? value.slice(0, 16) : ""
}
