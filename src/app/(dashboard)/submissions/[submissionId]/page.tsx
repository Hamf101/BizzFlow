import { ArrowLeft, MessageSquare, Save, Send } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { SubmissionActivityTimeline } from "@/components/submissions/submission-activity-timeline"
import { SubmissionFileField } from "@/components/submissions/submission-file-field"
import { SubmissionReviewControls } from "@/components/submissions/submission-review-controls"
import { SubmissionStatusBadge } from "@/components/submissions/submission-status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import { formatMediumDateTime } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { listOrganizationPeople } from "@/services/organization-service"
import { getInternalSubmission } from "@/services/submission-service"
import type { SubmissionDetail } from "@/services/submission-service"
import type { OrganizationMember } from "@/types/organization"
import type { SubmissionFile } from "@/types/submission"

import {
  createSubmissionCommentAction,
  saveSubmissionAction,
  submitSubmissionAction,
} from "../actions"

export const dynamic = "force-dynamic"

type SubmissionDetailParams = Promise<{ submissionId: string }>
type SubmissionDetailSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Loads one internal submission with editable creator draft or read-only detail.
 *
 * @param props - Submission path identifier and optional action feedback.
 * @returns Snapshot-driven answer form with verified file-field controls.
 */
export default async function SubmissionDetailPage({
  params,
  searchParams,
}: {
  params: SubmissionDetailParams
  searchParams: SubmissionDetailSearchParams
}): Promise<ReactElement> {
  const [{ submissionId }, query] = await Promise.all([params, searchParams])
  const detailPath = `/submissions/${encodeURIComponent(submissionId)}`
  const user = await loadAuthenticatedPageUser(detailPath)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "submission_detail_context_load_failed",
    failureDetails: { submissionId },
  })

  if (!contextResult.context) {
    redirect(
      buildRedirect("/submissions", {
        error:
          contextResult.errorMessage ??
          "Create an organization before viewing submissions.",
      })
    )
  }

  const context = contextResult.context
  const [result, peopleResult] = await Promise.all([
    getInternalSubmission({
      actorUserId: user.id,
      organizationId: context.organization.id,
      submissionId,
    })
      .then((detail: SubmissionDetail) => ({
        detail,
        errorMessage: null as string | null,
      }))
      .catch((error: unknown) => ({
        detail: null,
        errorMessage: getPageErrorMessage(
          error,
          "Unable to load internal submission."
        ),
      })),
    listOrganizationPeople(user.id, context.organization.id)
      .then((people) => ({
        members: people.members,
        errorMessage: null as string | null,
      }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load reviewer names."
        )
        console.warn("submission_review_people_load_failed", {
          organizationId: context.organization.id,
          reason: errorMessage,
          submissionId,
          userId: user.id,
        })
        return { members: [] as OrganizationMember[], errorMessage }
      }),
  ])

  if (!result.detail) {
    return (
      <SubmissionDetailShell query={query}>
        <Alert variant="destructive">
          <AlertTitle>Submission unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </SubmissionDetailShell>
    )
  }

  const detail = result.detail
  const submission = detail.submission
  const editable =
    (submission.status === "draft" || submission.status === "needs_changes") &&
    submission.createdBy === user.id &&
    canPerformOrganizationAction(
      context.membership.role,
      "submissions:edit"
    )
  const canAssign = canPerformOrganizationAction(
    context.membership.role,
    "submissions:assign"
  )
  const canReview = canPerformOrganizationAction(
    context.membership.role,
    "submissions:review"
  )
  const canComment =
    submission.status !== "draft" &&
    canPerformOrganizationAction(
      context.membership.role,
      "submission_comments:create"
    )
  const fileFieldContent = buildFileFieldContent({
    detail,
    editable,
    organizationId: context.organization.id,
  })

  return (
    <SubmissionDetailShell query={query}>
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "w-fit"
            )}
            href="/submissions"
          >
            <ArrowLeft />
            Back to submissions
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              {submission.title}
            </h1>
            <SubmissionStatusBadge status={submission.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Template revision {submission.templateRevision} · Submission revision{" "}
            {submission.revision}
          </p>
          {submission.assignedAt && (
            <p className="text-sm text-muted-foreground">
              Assigned to{" "}
              {getMemberDisplayName(
                submission.assignedTo,
                peopleResult.members
              )}
            </p>
          )}
        </div>
      </section>

      {submission.status === "submitted" && (
        <Alert>
          <AlertTitle>Waiting for review</AlertTitle>
          <AlertDescription>
            Submitted {formatMediumDateTime(submission.submittedAt)}. A manager
            can assign the review when it is ready to begin.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "in_review" && (
        <Alert>
          <AlertTitle>Review in progress</AlertTitle>
          <AlertDescription>
            The assigned reviewer can add context, while the assigned owner or
            manager records the binding outcome.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "needs_changes" && (
        <Alert variant={editable ? "default" : "destructive"}>
          <AlertTitle>Changes requested</AlertTitle>
          <AlertDescription>
            {editable
              ? "Update the answers or files below, then resubmit for another review."
              : "Only the team member who created this submission can make the requested changes."}
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "approved" && (
        <Alert>
          <AlertTitle>Submission approved</AlertTitle>
          <AlertDescription>
            The review is approved and ready to be marked complete after any
            remaining follow-up work.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "rejected" && (
        <Alert variant="destructive">
          <AlertTitle>Submission rejected</AlertTitle>
          <AlertDescription>
            The review history below includes the reviewer&apos;s decision note.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "completed" && (
        <Alert>
          <AlertTitle>Submission complete</AlertTitle>
          <AlertDescription>
            This review is closed. Its answers, files, discussion, and activity
            remain available as a read-only record.
          </AlertDescription>
        </Alert>
      )}

      {submission.status === "draft" && !editable && (
        <Alert>
          <AlertTitle>Read-only team draft</AlertTitle>
          <AlertDescription>
            Only the team member who created this draft can change or submit it.
          </AlertDescription>
        </Alert>
      )}

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Submission form</CardTitle>
          <CardDescription>
            {editable
              ? "Save progress at any time. Required fields and verified uploads are enforced when you submit."
              : "This view uses the exact template snapshot saved with the submission."}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{editable ? "Editable" : "Read only"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
          <form action={saveSubmissionAction} id="submission-answer-form">
            <input name="submissionId" type="hidden" value={submission.id} />
            <input
              name="expectedRevision"
              type="hidden"
              value={submission.revision}
            />
            <GeneratedDocumentContent
              answers={submission.values}
              content={submission.templateSnapshot}
              editable={editable}
              fileFieldContent={fileFieldContent}
            />
          </form>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Files are private, create-only objects verified by the server before
            submission.
          </span>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                form="submission-answer-form"
                type="submit"
                variant="outline"
              >
                <Save />
                {submission.status === "needs_changes"
                  ? "Save changes"
                  : "Save draft"}
              </Button>
              <Button
                form="submission-answer-form"
                formAction={submitSubmissionAction}
                type="submit"
              >
                <Send />
                {submission.status === "needs_changes" ? "Resubmit" : "Submit"}
              </Button>
            </div>
          )}
        </CardFooter>
      </Card>

      {peopleResult.errorMessage && submission.status !== "draft" && (
        <Alert variant="destructive">
          <AlertTitle>Reviewer names unavailable</AlertTitle>
          <AlertDescription>{peopleResult.errorMessage}</AlertDescription>
        </Alert>
      )}

      {submission.status !== "draft" && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <SubmissionReviewControls
              canAssign={canAssign && !peopleResult.errorMessage}
              canReview={canReview}
              currentUserId={user.id}
              members={peopleResult.members}
              submission={submission}
            />
            <SubmissionDiscussionCard
              canComment={canComment}
              submissionId={submission.id}
            />
          </div>
          <SubmissionActivityTimeline
            activity={detail.activity}
            comments={detail.comments}
            members={peopleResult.members}
          />
        </div>
      )}
    </SubmissionDetailShell>
  )
}

function SubmissionDiscussionCard({
  canComment,
  submissionId,
}: {
  canComment: boolean
  submissionId: string
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discussion</CardTitle>
        <CardDescription>
          Add context without changing the binding review decision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {canComment ? (
          <form
            action={createSubmissionCommentAction}
            className="flex flex-col gap-3"
          >
            <input name="submissionId" type="hidden" value={submissionId} />
            <label className="text-sm font-medium" htmlFor="submission-comment">
              Add comment
            </label>
            <textarea
              className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              id="submission-comment"
              maxLength={2_000}
              name="body"
              placeholder="Share an update or review context"
              required
            />
            <Button className="w-fit" type="submit" variant="outline">
              <MessageSquare />
              Add comment
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            You do not have permission to comment on this submission.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SubmissionDetailShell({
  children,
  query,
}: {
  children: ReactNode
  query: Awaited<SubmissionDetailSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {query.error && (
        <Alert variant="destructive">
          <AlertTitle>Submission action failed</AlertTitle>
          <AlertDescription>{query.error}</AlertDescription>
        </Alert>
      )}
      {query.message && (
        <Alert>
          <AlertTitle>Submission updated</AlertTitle>
          <AlertDescription>{query.message}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  )
}

function buildFileFieldContent(input: {
  detail: SubmissionDetail
  editable: boolean
  organizationId: string
}): Readonly<Record<string, ReactNode>> {
  const filesByFieldKey = new Map<string, SubmissionFile>(
    input.detail.files.map(
      (file: SubmissionFile): [string, SubmissionFile] => [file.fieldKey, file]
    )
  )
  const content: Record<string, ReactNode> = {}

  for (const section of Object.values(
    input.detail.submission.templateSnapshot.sections
  )) {
    for (const block of section.blocks) {
      if (block.type !== "file_field") {
        continue
      }

      content[block.fieldKey] = (
        <SubmissionFileField
          editable={input.editable}
          expectedRevision={input.detail.submission.revision}
          fieldKey={block.fieldKey}
          file={filesByFieldKey.get(block.fieldKey) ?? null}
          key={block.id}
          organizationId={input.organizationId}
          submissionId={input.detail.submission.id}
        />
      )
    }
  }

  return content
}

function getMemberDisplayName(
  userId: string | null,
  members: OrganizationMember[]
): string {
  if (!userId) {
    return "a former member"
  }

  const member = members.find(
    (candidate: OrganizationMember): boolean => candidate.userId === userId
  )
  return member?.fullName?.trim() || member?.email || "a team member"
}
