import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { formatMediumDateTime } from "@/lib/date-format"
import type { OrganizationRole } from "@/lib/permissions"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type {
  SubmissionActivityEvent,
  SubmissionComment,
  SubmissionReviewer,
  SubmissionReviewerDecision,
  SubmissionReviewTally,
} from "@/types/submission-review"

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner_admin: "Owner admin",
  manager: "Manager",
  staff: "Staff",
  external_reviewer: "External reviewer",
}

const DECISIONS: Record<SubmissionReviewerDecision, { label: string; variant: "default" | "destructive" | "outline" | "secondary" }> = {
  approved: { label: "Approved", variant: "default" },
  changes_requested: { label: "Requested changes", variant: "destructive" },
  dismissed: { label: "Change request set aside", variant: "secondary" },
  pending: { label: "Waiting", variant: "outline" },
}

/**
 * What a reviewer said in the discussion, apart from the notes that came with
 * their decisions, which the panel already shows as the decision's note.
 *
 * @param userId - The reviewer.
 * @param comments - Every comment on the submission.
 * @param activity - Every event on the submission.
 * @returns Their comments, oldest first.
 */
export function reviewerComments(
  userId: string,
  comments: readonly SubmissionComment[],
  activity: readonly SubmissionActivityEvent[]
): SubmissionComment[] {
  const withDecisions = new Set(activity.filter((event) => event.eventType !== "commented").map((event) => event.commentId))

  return comments.filter((comment) => comment.createdBy === userId && !withDecisions.has(comment.id))
}

/**
 * Says who reviews a submission and what each of them decided, the way a pull
 * request lists its reviewers, with how many approvals are needed and whether a
 * change request is holding it up.
 *
 * @param props - The reviewers this viewer may see, how all of them stand, the submission and the members.
 * @returns The reviewers panel.
 */
export function SubmissionReviewersPanel({
  activity,
  comments,
  members,
  reviewers,
  submission,
  tally,
}: {
  activity: readonly SubmissionActivityEvent[]
  comments: readonly SubmissionComment[]
  members: readonly OrganizationMember[]
  reviewers: readonly SubmissionReviewer[]
  submission: Submission
  tally: SubmissionReviewTally
}): ReactElement | null {
  if (tally.total === 0) {
    return null
  }

  // The database's rule: a reviewer set aside no longer counts, and never more than those still counting.
  const needed = Math.max(1, Math.min(submission.requiredApprovals ?? tally.counting, tally.counting))
  const byId = new Map(members.map((member) => [member.userId, member]))
  const open = tally.changesRequested > 0

  return (
    <section aria-label="Reviewers" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">Reviewers</h3>
        <p className="text-xs text-muted-foreground">
          {tally.approved} of {needed} {needed === 1 ? "approval" : "approvals"}
          {submission.requiredApprovals === null && tally.counting > 1 ? " (everyone)" : ""}
          {open ? " · held up by a change request" : ""}
        </p>
      </div>
      <ul className="divide-y divide-border/60">
        {reviewers.map((reviewer) => {
          const member = byId.get(reviewer.userId)
          const decision = DECISIONS[reviewer.decision]

          return (
            <li className="flex flex-col gap-1.5 py-2.5" key={reviewer.userId}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{member ? member.fullName?.trim() || member.email : "A former member"}</span>
                  {member ? <span className="block text-xs text-muted-foreground">{ROLE_LABELS[member.role]}</span> : null}
                </span>
                <Badge variant={decision.variant}>{decision.label}</Badge>
              </div>
              {reviewer.note ? (
                <p className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm text-muted-foreground">{reviewer.note}</p>
              ) : null}
              {reviewer.decidedAt ? <p className="text-xs text-muted-foreground">{formatMediumDateTime(reviewer.decidedAt)}</p> : null}
              {reviewerComments(reviewer.userId, comments, activity).map((comment) => (
                <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-3 py-2 text-sm" key={comment.id}>
                  {comment.body}
                  <span className="mt-1 block text-xs text-muted-foreground">Commented {formatMediumDateTime(comment.createdAt)}</span>
                </p>
              ))}
            </li>
          )
        })}
      </ul>
      {reviewers.length < tally.total ? (
        <p className="text-xs text-muted-foreground">
          {tally.total - reviewers.length} more {tally.total - reviewers.length === 1 ? "reviewer was" : "reviewers were"} chosen by someone more senior, so only you are listed.
        </p>
      ) : null}
    </section>
  )
}
