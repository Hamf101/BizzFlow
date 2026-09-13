import type { ReactElement, ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import type { OrganizationRole } from "@/lib/permissions"
import type { OrganizationMember } from "@/types/organization"
import type { TaskReminderStatus, TaskStatus } from "@/types/task"

type BadgePresentation = {
  className?: string
  label: string
  variant: "default" | "destructive" | "ghost" | "outline" | "secondary"
}

// Mirrors the roles the task service accepts as an assignee or reminder
// recipient, so the pickers never offer a member the service would reject.
const INTERNAL_TASK_ROLES: readonly OrganizationRole[] = [
  "owner_admin",
  "manager",
  "staff",
]

const TASK_STATUS_PRESENTATIONS: Record<TaskStatus, BadgePresentation> = {
  open: { label: "Open", variant: "outline" },
  in_progress: { label: "In progress", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  cancelled: {
    className: "text-muted-foreground",
    label: "Cancelled",
    variant: "ghost",
  },
}

const TASK_REMINDER_STATUS_PRESENTATIONS: Record<
  TaskReminderStatus,
  BadgePresentation
> = {
  pending: { label: "Pending", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
  cancelled: {
    className: "text-muted-foreground",
    label: "Cancelled",
    variant: "ghost",
  },
  // Sync bookkeeping. listTaskReminders filters these out, so this exists to
  // keep the map exhaustive rather than to be rendered.
  superseded: {
    className: "text-muted-foreground",
    label: "Replaced",
    variant: "ghost",
  },
}

/**
 * Renders one task lifecycle state with a stable label and tone.
 *
 * @param props - Current task status.
 * @returns Status badge shared by the task list and task detail.
 */
export function TaskStatusBadge({
  status,
}: {
  status: TaskStatus
}): ReactElement {
  const presentation = TASK_STATUS_PRESENTATIONS[status]

  return (
    <Badge className={presentation.className} variant={presentation.variant}>
      {presentation.label}
    </Badge>
  )
}

/**
 * Renders one reminder delivery state with a stable label and tone.
 *
 * @param props - Current reminder delivery status.
 * @returns Status badge for a scheduled task reminder.
 */
export function TaskReminderStatusBadge({
  status,
}: {
  status: TaskReminderStatus
}): ReactElement {
  const presentation = TASK_REMINDER_STATUS_PRESENTATIONS[status]

  return (
    <Badge className={presentation.className} variant={presentation.variant}>
      {presentation.label}
    </Badge>
  )
}

/**
 * Wraps a task page with its shared stack spacing.
 *
 * @param props - Page content.
 * @returns Page shell for task workspace content.
 */
export function TaskPageShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}

/**
 * Reads the human-readable label for a task lifecycle state.
 *
 * @param status - Task lifecycle state.
 * @returns Label shared by badges, filters, and transition controls.
 */
export function getTaskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_PRESENTATIONS[status].label
}

/**
 * Narrows organization people to the members a task may be given to.
 *
 * @param members - Every member returned for the organization.
 * @returns Active internal members, in the order the directory returned them.
 */
export function listInternalTaskMembers(
  members: OrganizationMember[]
): OrganizationMember[] {
  return members.filter(
    (member: OrganizationMember): boolean =>
      member.status === "active" && INTERNAL_TASK_ROLES.includes(member.role)
  )
}
