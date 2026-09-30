import { Check, CheckCheck, MessageSquare, RotateCcw, UserRoundCheck, X } from "lucide-react"
import type { ReactElement } from "react"

import {
  commentFromReviewAction,
  dismissChangesRequestAction,
  setSubmissionReviewersAction,
  transitionSubmissionAction,
} from "@/app/(dashboard)/submissions/actions"
import { ROLE_LABELS, SubmissionReviewersPanel } from "@/components/submissions/submission-reviewers-panel"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { OrganizationRole } from "@/lib/permissions"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { SubmissionActivityEvent, SubmissionComment, SubmissionReviewer, SubmissionReviewTally } from "@/types/submission-review"

// Anyone who reviews work can be named a reviewer, including people from outside.
const eligibleReviewerRoles: readonly OrganizationRole[] = ["owner_admin", "manager", "external_reviewer"]

/**
 * Renders the reviewers, how to name them, and the decisions each of them can
 * record: approve, request changes (which holds the submission up), or reject.
 * The person who assigned the reviewers can set a change request aside.
 *
 * @param props - Submission, what the viewer may do, the reviewers they can see, and the members.
 * @returns Review controls allowed by the current status and the viewer's part in it.
 */
export function SubmissionReviewControls({
  activity,
  canAssign,
  canReview,
  comments,
  currentUserId,
  isRequester,
  members,
  reviewers,
  submission,
  tally,
}: {
  activity: SubmissionActivityEvent[]
  canAssign: boolean
  canReview: boolean
  comments: SubmissionComment[]
  currentUserId: string
  isRequester: boolean
  members: OrganizationMember[]
  reviewers: SubmissionReviewer[]
  submission: Submission
  tally: SubmissionReviewTally
}): ReactElement | null {
  const assignmentOpen =
    submission.status === "submitted" ||
    submission.status === "in_review" ||
    submission.status === "needs_changes"
  const mine = reviewers.find((reviewer) => reviewer.userId === currentUserId)
  // Being named a reviewer is what lets someone approve or ask for changes, whatever their role.
  const canDecide = mine !== undefined
  const startsReview = submission.status === "submitted"
  // Who was chosen is only editable by someone who can see every reviewer.
  const seesEveryone = reviewers.length === tally.total
  const eligibleMembers = members.filter(
    (member: OrganizationMember): boolean =>
      member.status === "active" && eligibleReviewerRoles.includes(member.role)
  )
  const asideCandidates =
    isRequester && submission.status === "needs_changes"
      ? reviewers.filter((reviewer) => reviewer.decision === "changes_requested")
      : []

  if (!canAssign && !canReview && tally.total === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <SubmissionReviewersPanel activity={activity} comments={comments} members={members} reviewers={reviewers} submission={submission} tally={tally} />

        {canAssign && assignmentOpen && seesEveryone && (
          <form action={setSubmissionReviewersAction} className="flex flex-col gap-3 border-t pt-5 first:border-t-0 first:pt-0">
            <input name="submissionId" type="hidden" value={submission.id} />
            <input name="expectedRevision" type="hidden" value={submission.revision} />
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-sm font-medium">
                {startsReview ? "Reviewers" : tally.total > 0 ? "Change reviewers" : "Add reviewers"}
              </legend>
              {eligibleMembers.map((member: OrganizationMember) => (
                <label className="flex items-center gap-2.5 text-sm" key={member.id}>
                  <input
                    className="size-4 accent-primary"
                    defaultChecked={reviewers.some((reviewer) => reviewer.userId === member.userId)}
                    name="reviewerIds"
                    type="checkbox"
                    value={member.userId}
                  />
                  <span className="min-w-0 truncate">
                    {formatMemberLabel(member)} · {ROLE_LABELS[member.role]}
                  </span>
                </label>
              ))}
            </fieldset>
            {eligibleMembers.length > 1 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="submission-required-approvals">
                  Approvals needed
                </label>
                <Select
                  defaultValue={submission.requiredApprovals === null ? "" : String(submission.requiredApprovals)}
                  id="submission-required-approvals"
                  name="requiredApprovals"
                >
                  <option value="">Everyone must approve</option>
                  {eligibleMembers.map((member: OrganizationMember, index: number) => (
                    <option key={member.id} value={String(index + 1)}>
                      At least {index + 1}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <Button className="w-fit" type="submit" variant="outline">
              <UserRoundCheck />
              {startsReview ? "Start review" : "Save reviewers"}
            </Button>
          </form>
        )}

        {canAssign && assignmentOpen && !seesEveryone && (
          <p className="border-t pt-5 text-sm text-muted-foreground">
            Someone more senior chose the other reviewers, so only they or an owner can change them.
          </p>
        )}

        {asideCandidates.map((reviewer) => (
          <form action={dismissChangesRequestAction} className="flex flex-col gap-3 border-t pt-5" key={reviewer.userId}>
            <input name="submissionId" type="hidden" value={submission.id} />
            <input name="expectedRevision" type="hidden" value={submission.revision} />
            <input name="reviewerUserId" type="hidden" value={reviewer.userId} />
            <label className="text-sm font-medium" htmlFor={`aside-${reviewer.userId}`}>
              Set aside {formatReviewerName(members, reviewer.userId)}’s change request
            </label>
            <Textarea
              className="min-h-20"
              id={`aside-${reviewer.userId}`}
              maxLength={2_000}
              name="comment"
              placeholder="Why it does not need to hold this up"
              required
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="outline">
                <RotateCcw />
                Set aside
              </Button>
              <Button name="alsoApprove" type="submit" value="yes">
                <Check />
                Set aside and approve
              </Button>
            </div>
          </form>
        ))}

        {submission.status === "in_review" && canDecide && (
          <form
            action={transitionSubmissionAction}
            className="flex flex-col gap-3 border-t pt-5"
          >
            <input name="submissionId" type="hidden" value={submission.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={submission.revision}
            />
            <label className="text-sm font-medium" htmlFor="review-comment">
              Review note
            </label>
            <Textarea
              aria-describedby="review-comment-description"
              className="min-h-24"
              id="review-comment"
              maxLength={2_000}
              name="comment"
              placeholder="Required when requesting changes or rejecting"
            />
            <p
              className="text-xs text-muted-foreground"
              id="review-comment-description"
            >
              A note is required for requested changes and rejection. It is
              optional for approval, and a comment leaves your decision as it is. A change request holds the submission up
              until whoever chose the reviewers sets it aside.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                name="targetStatus"
                type="submit"
                value="needs_changes"
                variant="outline"
              >
                <RotateCcw />
                Request changes
              </Button>
              <Button name="targetStatus" type="submit" value="approved">
                <Check />
                {mine?.decision === "approved" ? "Approved" : "Approve"}
              </Button>
              {canReview && (
                <Button
                  name="targetStatus"
                  type="submit"
                  value="rejected"
                  variant="destructive"
                >
                  <X />
                  Reject
                </Button>
              )}
              <Button formAction={commentFromReviewAction} type="submit" variant="ghost">
                <MessageSquare />
                Comment
              </Button>
            </div>
          </form>
        )}

        {submission.status === "approved" && canDecide && canReview && (
          <form
            action={transitionSubmissionAction}
            className="flex flex-col gap-3 border-t pt-5"
          >
            <input name="submissionId" type="hidden" value={submission.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={submission.revision}
            />
            <input name="targetStatus" type="hidden" value="completed" />
            <p className="text-sm text-muted-foreground">
              Approval is recorded. Mark the submission complete when any
              follow-up work has finished.
            </p>
            <Button className="w-fit" type="submit">
              <CheckCheck />
              Mark complete
            </Button>
          </form>
        )}

        {canReview &&
          (submission.status === "in_review" ||
            submission.status === "approved") &&
          !canDecide && (
            <p className="border-t pt-5 text-sm text-muted-foreground">
              Only the reviewers record decisions. Add yourself as a reviewer to
              continue.
            </p>
          )}
      </CardContent>
    </Card>
  )
}

function formatMemberLabel(member: OrganizationMember): string {
  return member.fullName?.trim() || member.email
}

function formatReviewerName(members: readonly OrganizationMember[], userId: string): string {
  const member = members.find((candidate) => candidate.userId === userId)

  return member ? formatMemberLabel(member) : "a former member"
}
