import { Check, CheckCheck, RotateCcw, UserRoundCheck, X } from "lucide-react"
import type { ReactElement } from "react"

import {
  assignSubmissionAction,
  transitionSubmissionAction,
} from "@/app/(dashboard)/submissions/actions"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { OrganizationRole } from "@/lib/permissions"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"

const eligibleAssigneeRoles: readonly OrganizationRole[] = [
  "owner_admin",
  "manager",
  "external_reviewer",
]

const roleLabels: Record<OrganizationRole, string> = {
  owner_admin: "Owner admin",
  manager: "Manager",
  staff: "Staff",
  external_reviewer: "External reviewer",
}

/**
 * Renders assignment and binding review actions for a submission manager.
 *
 * @param props - Submission, actor permissions, and active organization members.
 * @returns Review controls allowed by the current status and assignment.
 */
export function SubmissionReviewControls({
  canAssign,
  canReview,
  currentUserId,
  members,
  submission,
}: {
  canAssign: boolean
  canReview: boolean
  currentUserId: string
  members: OrganizationMember[]
  submission: Submission
}): ReactElement | null {
  const assignmentOpen =
    submission.status === "submitted" ||
    submission.status === "in_review" ||
    submission.status === "needs_changes"
  const canMakeBindingDecision =
    canReview && submission.assignedTo === currentUserId
  const startsReview = submission.status === "submitted"
  const eligibleMembers = members.filter(
    (member: OrganizationMember): boolean =>
      member.status === "active" && eligibleAssigneeRoles.includes(member.role)
  )

  if (!canAssign && !canReview) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Review</CardTitle>
        <CardDescription>
          Assign a reviewer, then record the binding outcome here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {canAssign && assignmentOpen && (
          <form action={assignSubmissionAction} className="flex flex-col gap-3">
            <input name="submissionId" type="hidden" value={submission.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={submission.revision}
            />
            <label
              className="text-sm font-medium"
              htmlFor="submission-assignee"
            >
              {startsReview
                ? "Reviewer"
                : submission.assignedTo
                  ? "Reassign review"
                  : "Assign review"}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                defaultValue={submission.assignedTo ?? ""}
                id="submission-assignee"
                name="assignedTo"
                required
              >
                {!submission.assignedTo && (
                  <option disabled value="">
                    Choose a reviewer
                  </option>
                )}
                {eligibleMembers.map((member: OrganizationMember) => (
                  <option key={member.id} value={member.userId}>
                    {formatMemberLabel(member)} · {roleLabels[member.role]}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="outline">
                <UserRoundCheck />
                {startsReview
                  ? "Start review"
                  : submission.assignedTo
                    ? "Reassign"
                    : "Assign"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Assigning a submitted item starts its review. External reviewers
              can view and comment, but cannot record a binding decision.
            </p>
          </form>
        )}

        {submission.status === "in_review" && canMakeBindingDecision && (
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
              optional for approval.
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
                Approve
              </Button>
              <Button
                name="targetStatus"
                type="submit"
                value="rejected"
                variant="destructive"
              >
                <X />
                Reject
              </Button>
            </div>
          </form>
        )}

        {submission.status === "approved" && canMakeBindingDecision && (
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
          !canMakeBindingDecision && (
            <p className="border-t pt-5 text-sm text-muted-foreground">
              The assigned owner or manager records the binding decision.
              Reassign this review to yourself or another manager to continue.
            </p>
          )}
      </CardContent>
    </Card>
  )
}

function formatMemberLabel(member: OrganizationMember): string {
  return member.fullName?.trim() || member.email
}
