import { ListChecks, Plus } from "lucide-react"
import Link from "next/link"
import type { ReactElement } from "react"

import {
  formatTaskMemberName,
  TaskStatusBadge,
} from "@/components/tasks/task-presentation"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatMediumDateTime } from "@/lib/date-format"
import { cn } from "@/lib/utils"
import type { OrganizationMember } from "@/types/organization"
import type { Task } from "@/types/task"

type SubmissionTaskPanelProps = {
  /** Tasks already raised from this submission. */
  tasks: Task[]
  /** Members eligible to hold a task, already narrowed to internal roles. */
  members: OrganizationMember[]
  /** Whether the viewer may raise a task at all. */
  canCreate: boolean
  /** Whether the viewer may hand the new task to someone. */
  canAssign: boolean
  /** Viewer identifier, so their own name renders as "You". */
  currentUserId: string
  /** Submission the new task is raised from. */
  submissionId: string
  /** Server action that creates the task. */
  createAction: (formData: FormData) => Promise<void>
  /** Message shown instead of the form when task loading failed. */
  errorMessage?: string | null
}

/**
 * Follow-up work raised from a submission, listed and created in place.
 *
 * The hidden `submissionId` is what links the task back here: the task service
 * verifies it belongs to the same tenant, and the create action returns the
 * member to this submission if anything is rejected.
 *
 * @param props - Linked tasks, eligible members, permissions, and the action.
 * @returns Card listing follow-up tasks with an inline create form.
 */
export function SubmissionTaskPanel({
  tasks,
  members,
  canCreate,
  canAssign,
  currentUserId,
  submissionId,
  createAction,
  errorMessage = null,
}: SubmissionTaskPanelProps): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          Follow-up tasks
        </CardTitle>
        <CardDescription>
          Track the work this submission created without leaving the review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No follow-up tasks yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task: Task) => (
              <li key={task.id}>
                <Link
                  className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-secondary/50"
                  href={`/tasks/${encodeURIComponent(task.id)}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{task.title}</span>
                    <TaskStatusBadge status={task.status} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTaskMemberName(
                      task.assignedTo,
                      members,
                      currentUserId
                    )}
                    {task.dueAt
                      ? ` · due ${formatMediumDateTime(task.dueAt)}`
                      : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {canCreate ? (
          <details className="group/new-submission-task rounded-lg border border-border">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary/50 [&::-webkit-details-marker]:hidden">
              <Plus className="size-4 text-muted-foreground" />
              New task from this submission
            </summary>
            <div className="border-t border-border p-3">
              <form action={createAction} className="flex flex-col gap-4">
                <input name="submissionId" type="hidden" value={submissionId} />
                <Field>
                  <FieldLabel htmlFor="submission-task-title">Title</FieldLabel>
                  <Input
                    id="submission-task-title"
                    maxLength={200}
                    name="title"
                    placeholder="Collect the missing insurance certificate"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="submission-task-description">
                    Description
                  </FieldLabel>
                  <Textarea
                    id="submission-task-description"
                    maxLength={5_000}
                    name="description"
                    placeholder="Optional context for whoever picks this up"
                  />
                </Field>
                <div className="flex flex-col gap-4 sm:flex-row">
                  <Field className="sm:flex-1">
                    <FieldLabel htmlFor="submission-task-due">
                      Due (UTC)
                    </FieldLabel>
                    <Input
                      id="submission-task-due"
                      name="dueAt"
                      type="datetime-local"
                    />
                    <FieldDescription>
                      The assignee is reminded when this falls due.
                    </FieldDescription>
                  </Field>
                  {canAssign && (
                    <Field className="sm:flex-1">
                      <FieldLabel htmlFor="submission-task-assignee">
                        Assignee
                      </FieldLabel>
                      <Select
                        defaultValue=""
                        id="submission-task-assignee"
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
                        Emailed when the task is handed over.
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
        ) : (
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "w-fit"
            )}
            href="/tasks"
          >
            Open the task workspace
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
