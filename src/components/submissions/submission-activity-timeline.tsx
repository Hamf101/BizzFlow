import type { ReactElement } from "react"

import {
  type SubmissionActivityEvent,
  type SubmissionComment,
} from "@/services/submission-service"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatMediumDateTime } from "@/lib/date-format"
import type { OrganizationMember } from "@/types/organization"

/**
 * Displays immutable submission review events and their associated notes.
 *
 * @param props - Activity, comments, and member identities for display labels.
 * @returns A chronological review history card.
 */
export function SubmissionActivityTimeline({
  activity,
  comments,
  members,
}: {
  activity: SubmissionActivityEvent[]
  comments: SubmissionComment[]
  members: OrganizationMember[]
}): ReactElement {
  const memberLabels = new Map<string, string>(
    members.map((member: OrganizationMember): [string, string] => [
      member.userId,
      member.fullName?.trim() || member.email,
    ])
  )
  const commentsById = new Map<string, SubmissionComment>(
    comments.map((comment: SubmissionComment): [string, SubmissionComment] => [
      comment.id,
      comment,
    ])
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Assignment, review decisions, and discussion in one history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol
            aria-label="Submission activity"
            className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto"
            tabIndex={0}
          >
            {activity.map((event: SubmissionActivityEvent) => {
              const comment = event.commentId
                ? commentsById.get(event.commentId)
                : undefined

              return (
                <li
                  className="flex gap-3 rounded-lg border bg-background p-3"
                  key={event.id}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">
                        {formatActorLabel(event.actorUserId, memberLabels)}
                      </span>{" "}
                      {formatActivityDescription(event, memberLabels)}
                    </p>
                    {comment && (
                      <p className="mt-2 whitespace-pre-wrap break-words border-l-2 pl-3 text-sm text-muted-foreground">
                        {comment.body}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatMediumDateTime(event.createdAt)} · revision{" "}
                      {event.submissionRevision}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function formatActorLabel(
  actorUserId: string | null,
  memberLabels: ReadonlyMap<string, string>
): string {
  if (!actorUserId) {
    return "A former member"
  }

  return memberLabels.get(actorUserId) ?? "A team member"
}

function formatActivityDescription(
  event: SubmissionActivityEvent,
  memberLabels: ReadonlyMap<string, string>
): string {
  if (event.eventType === "submitted") {
    return "submitted the form."
  }

  if (event.eventType === "resubmitted") {
    return "resubmitted the form after making changes."
  }

  if (event.eventType === "assigned") {
    const assignee = event.assigneeUserId
      ? memberLabels.get(event.assigneeUserId) ?? "a team member"
      : "a team member"
    return `assigned the review to ${assignee}.`
  }

  if (event.eventType === "commented") {
    return "added a comment."
  }

  if (event.eventType === "changes_requested") {
    return "requested changes."
  }

  if (event.eventType === "approved") {
    return "approved the submission."
  }

  if (event.eventType === "rejected") {
    return "rejected the submission."
  }

  return "marked the submission complete."
}
