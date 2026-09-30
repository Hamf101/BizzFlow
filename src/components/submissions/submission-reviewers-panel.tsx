import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { formatMediumDateTime } from "@/lib/date-format"
import type { OrganizationRole } from "@/lib/permissions"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { SubmissionReviewer, SubmissionReviewerDecision, SubmissionReviewTally } from "@/types/submission-review"

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
 * Says who reviews a submission and what each of them decided, the way a pull
 * request lists its reviewers, with how many approvals are needed and whether a
 * change request is holding it up.
 *
 * @param props - The reviewers this viewer may see, how all of them stand, the submission and the members.
 * @returns The reviewers panel.
 */
export function SubmissionReviewersPanel({
  members,
  reviewers,
  submission,
  tally,
}: {
  members: readonly OrganizationMember[]
  reviewers: readonly SubmissionReviewer[]
  submission: Submission
  tally: SubmissionReviewTally
}): ReactElement | null {
  if (tally.total === 0) {
    return null
  }

  const needed = submission.requiredApprovals ?? tally.total
  const byId = new Map(members.map((member) => [member.userId, member]))
  const open = tally.changesRequested > 0

  return (
    <section aria-label="Reviewers" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">Reviewers</h3>
        <p className="text-xs text-muted-foreground">
          {tally.approved} of {needed} {needed === 1 ? "approval" : "approvals"}
          {submission.requiredApprovals === null && tally.total > 1 ? " (everyone)" : ""}
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
