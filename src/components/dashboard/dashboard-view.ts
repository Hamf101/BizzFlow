import { formatAuditAction } from "@/components/audit/audit-log-view"
import { describeDocumentKind, describeWorkflowStatus, getDocumentHref } from "@/components/files/file-list-view"
import { formatMemberName } from "@/components/people/member-name"
import type { AuditLogEntry } from "@/types/audit"
import type { AccessibleDocumentSummary } from "@/types/document"
import type { OrganizationMember } from "@/types/organization"
import type { Submission, SubmissionStatus } from "@/types/submission"
import { isTerminalTaskStatus, type Task } from "@/types/task"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

const DAY_MS = 86_400_000
const WEEK_DAYS = 7

/** How loudly a row asks for attention: late, yours to act on, or when you can. */
export type QueueTone = "critical" | "quiet" | "you"

/** What kind of thing waits: the row's small label and its icon. */
export type QueueKind = "Awaiting signatures" | "Draft" | "Needs changes" | "Overdue task" | "Review"

/** One thing waiting on the viewer, ready to draw as a row. */
export type QueueItem = Readonly<{
  action: string
  context: string | null
  href: string
  id: string
  kind: QueueKind
  title: string
  tone: QueueTone
  when: string
}>

/** One task due in the coming week, named for the viewer. */
export type DueTask = Readonly<{ assignee: string; due: string; href: string; id: string; title: string }>

/** One recently changed file, ready to draw. */
export type RecentFile = Readonly<{ href: string; id: string; meta: string; title: string }>

/** One recent event in the organization, in plain words. */
export type ActivityRow = Readonly<{ actor: string | null; id: string; text: string; when: string }>

/** One submission stage, the submissions list filter it opens, and how it reads. */
export type WorkflowStage = Readonly<{
  filter: string
  label: string
  status: SubmissionStatus
  tone?: "done" | "warn"
}>

/** The stages a glance at the workflow shows, in the order work moves. */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  { filter: "draft", label: "Draft", status: "draft" },
  { filter: "submitted", label: "Submitted", status: "submitted" },
  { filter: "in_review", label: "In review", status: "in_review" },
  { filter: "needs_changes", label: "Needs changes", status: "needs_changes", tone: "warn" },
  { filter: "decided", label: "Approved", status: "approved" },
  { filter: "decided", label: "Completed this month", status: "completed", tone: "done" },
]

type QueueInput = Readonly<{
  actorUserId: string
  /** Generated documents the viewer sent that still wait on a signer. */
  awaitingSignatures: readonly AccessibleDocumentSummary[]
  canReview: boolean
  members: readonly OrganizationMember[]
  now: Date
  submissions: readonly Submission[]
  tasks: readonly Task[]
}>

/**
 * Ranks everything waiting on the viewer: late tasks first, then reviews and
 * returned work oldest first, then signatures still out, then their drafts.
 *
 * @param input - The viewer, what they may do, and the work loaded for them.
 * @returns Rows in the order to act on them.
 */
export function buildQueue(input: QueueInput): QueueItem[] {
  const { actorUserId, members, now } = input
  const late = input.tasks
    .filter((task) => task.assignedTo === actorUserId && isOverdue(task, now))
    .sort(byOldest((task: Task) => task.dueAt ?? ""))
    .map((task): QueueItem => ({
      action: "Open",
      context: null,
      href: `/tasks/${encodeURIComponent(task.id)}`,
      id: task.id,
      kind: "Overdue task",
      title: task.title,
      tone: "critical",
      when: `Due ${relativeDay(task.dueAt ?? "", now)}`,
    }))
  const reviews = input.canReview
    ? input.submissions
        .filter(
          (submission) =>
            (submission.status === "submitted" || submission.status === "in_review") &&
            (submission.assignedTo === null || submission.assignedTo === actorUserId)
        )
        .sort(byOldest((submission: Submission) => submission.submittedAt ?? submission.updatedAt))
        .map((submission): QueueItem => ({
          action: "Review",
          context:
            submission.submittedBy && submission.submittedBy !== actorUserId
              ? `From ${formatMemberName(submission.submittedBy, members)}`
              : null,
          href: submissionHref(submission),
          id: submission.id,
          kind: "Review",
          title: submission.title,
          tone: "you",
          when: `Submitted ${relativeDay(submission.submittedAt ?? submission.updatedAt, now)}`,
        }))
    : []
  const own = input.submissions.filter((submission) => submission.createdBy === actorUserId)
  const returned = own
    .filter((submission) => submission.status === "needs_changes")
    .sort(byOldest((submission: Submission) => submission.updatedAt))
    .map((submission): QueueItem => ({
      action: "Edit",
      context: null,
      href: submissionHref(submission),
      id: submission.id,
      kind: "Needs changes",
      title: submission.title,
      tone: "you",
      when: `Returned ${relativeDay(submission.updatedAt, now)}`,
    }))
  const signatures = [...input.awaitingSignatures]
    .sort(byOldest((document: AccessibleDocumentSummary) => document.updatedAt))
    .map((document): QueueItem => ({
      action: "Open",
      context: null,
      href: `/documents/${encodeURIComponent(document.id)}/edit`,
      id: document.id,
      kind: "Awaiting signatures",
      title: document.title,
      tone: "you",
      when: `Sent ${relativeDay(document.updatedAt, now)}`,
    }))
  const drafts = own
    .filter((submission) => submission.status === "draft")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .map((submission): QueueItem => ({
      action: "Continue",
      context: null,
      href: submissionHref(submission),
      id: submission.id,
      kind: "Draft",
      title: submission.title,
      tone: "quiet",
      when: `Edited ${relativeDay(submission.updatedAt, now)}`,
    }))

  return [...late, ...reviews, ...returned, ...signatures, ...drafts]
}

/**
 * Picks the open tasks due from now until a week from now, soonest first.
 *
 * @param tasks - Tasks the viewer may see.
 * @param members - Members, to name who each task is for.
 * @param actorUserId - The viewer, who is called "You".
 * @param now - The moment the page loaded.
 * @returns The week's tasks, ready to draw.
 */
export function selectDueThisWeek(
  tasks: readonly Task[],
  members: readonly OrganizationMember[],
  actorUserId: string,
  now: Date
): DueTask[] {
  const end = now.getTime() + WEEK_DAYS * DAY_MS

  return tasks
    .filter((task) => {
      const due = task.dueAt ? Date.parse(task.dueAt) : Number.NaN
      return !isTerminalTaskStatus(task.status) && due >= now.getTime() && due < end
    })
    .sort(byOldest((task: Task) => task.dueAt ?? ""))
    .map((task) => ({
      assignee: formatMemberName(task.assignedTo, members, actorUserId),
      due: new Intl.DateTimeFormat("en", { day: "numeric", month: "short", weekday: "short" }).format(
        new Date(task.dueAt ?? "")
      ),
      href: `/tasks/${encodeURIComponent(task.id)}`,
      id: task.id,
      title: task.title,
    }))
}

/**
 * Words the most recently changed files: where each stands, or when it last
 * changed.
 *
 * @param documents - Files the viewer may open, newest first.
 * @param statuses - Where generated documents stand, by id, as far as known.
 * @param now - The moment the page loaded.
 * @returns The files, ready to draw.
 */
export function describeRecentFiles(
  documents: readonly AccessibleDocumentSummary[],
  statuses: ReadonlyMap<string, GeneratedDocumentWorkflowStatus | null>,
  now: Date
): RecentFile[] {
  return documents.map((document) => ({
    href: getDocumentHref(document),
    id: document.id,
    meta:
      describeWorkflowStatus(statuses.get(document.id) ?? null)?.label ??
      `${describeDocumentKind(document)} · Edited ${relativeDay(document.updatedAt, now)}`,
    title: document.title,
  }))
}

/**
 * Words recent audit events for a glance: what happened, who did it, and when.
 *
 * @param entries - Newest audit events first.
 * @param members - Members, to name who acted.
 * @param actorUserId - The viewer, who is called "You".
 * @param now - The moment the page loaded.
 * @returns One row per event.
 */
export function describeActivity(
  entries: readonly AuditLogEntry[],
  members: readonly OrganizationMember[],
  actorUserId: string,
  now: Date
): ActivityRow[] {
  return entries.map((entry) => {
    const when = relativeDay(entry.createdAt, now)

    return {
      actor: entry.actorUserId ? formatMemberName(entry.actorUserId, members, actorUserId) : null,
      id: entry.id,
      text: formatAuditAction(entry.action),
      when: when.charAt(0).toUpperCase() + when.slice(1),
    }
  })
}

/**
 * Says how long ago something happened in the words people use: today,
 * yesterday, 3 days ago, or the date once it is over a week old.
 *
 * @param value - When it happened.
 * @param now - The moment the page loaded.
 * @returns A short phrase to follow a verb, such as "Submitted".
 */
export function relativeDay(value: string, now: Date): string {
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(value)) / DAY_MS))

  return days < WEEK_DAYS
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-days, "day")
    : new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(value))
}

function byOldest<Item>(at: (item: Item) => string): (left: Item, right: Item) => number {
  return (left: Item, right: Item) => Date.parse(at(left)) - Date.parse(at(right))
}

function isOverdue(task: Task, now: Date): boolean {
  return task.dueAt !== null && !isTerminalTaskStatus(task.status) && Date.parse(task.dueAt) < now.getTime()
}

function submissionHref(submission: Submission): string {
  return `/submissions/${encodeURIComponent(submission.id)}`
}
