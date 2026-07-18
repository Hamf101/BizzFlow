import { ClipboardList, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SubmissionStatusBadge } from "@/components/submissions/submission-status-badge"
import { buttonVariants } from "@/components/ui/button"
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
import { listInternalSubmissions } from "@/services/submission-service"
import type { Submission } from "@/types/submission"

export const dynamic = "force-dynamic"

type SubmissionsSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Lists internal submissions visible to the authenticated organization member.
 *
 * @param props - Optional action feedback encoded in search parameters.
 * @returns Creator-scoped staff list or tenant-wide owner/manager list.
 */
export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: SubmissionsSearchParams
}): Promise<ReactElement> {
  const query = await searchParams
  const user = await loadAuthenticatedPageUser("/submissions")
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "submissions_context_load_failed",
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <SubmissionsShell query={query}>
          <Alert variant="destructive">
            <AlertTitle>Submissions unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </SubmissionsShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing submissions.",
      })
    )
  }

  const context = contextResult.context
  const canCreate = canPerformOrganizationAction(
    context.membership.role,
    "submissions:create"
  )
  const result = await listInternalSubmissions({
    actorUserId: user.id,
    organizationId: context.organization.id,
  })
    .then((submissions: Submission[]) => ({
      submissions,
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(
        error,
        "Unable to load internal submissions."
      )
      console.warn("submissions_list_load_failed", {
        organizationId: context.organization.id,
        reason: errorMessage,
        userId: user.id,
      })
      return { submissions: [] as Submission[], errorMessage }
    })

  return (
    <SubmissionsShell query={query}>
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">Submissions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Fill published forms, attach supporting files, and send completed
            work to {context.organization.name}.
          </p>
        </div>
        {canCreate && (
          <Link className={cn(buttonVariants())} href="/submissions/new">
            <Plus />
            Start submission
          </Link>
        )}
      </section>

      {result.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Submission list unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      ) : (
        <SubmissionList
          canCreate={canCreate}
          currentUserId={user.id}
          submissions={result.submissions}
        />
      )}
    </SubmissionsShell>
  )
}

function SubmissionsShell({
  children,
  query,
}: {
  children: ReactNode
  query: Awaited<SubmissionsSearchParams>
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

function SubmissionList({
  canCreate,
  currentUserId,
  submissions,
}: {
  canCreate: boolean
  currentUserId: string
  submissions: Submission[]
}): ReactElement {
  if (submissions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No submissions yet</CardTitle>
          <CardDescription>
            Start from a published template and save your work as a draft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" />
            <p className="max-w-sm text-sm text-muted-foreground">
              Drafts stay editable for their creator until they are submitted.
            </p>
          </div>
        </CardContent>
        {canCreate && (
          <CardFooter>
            <Link
              className={cn(buttonVariants({ variant: "outline" }))}
              href="/submissions/new"
            >
              <Plus />
              Start the first submission
            </Link>
          </CardFooter>
        )}
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {submissions.map((submission: Submission) => (
        <Card key={submission.id}>
          <CardHeader>
            <CardTitle>{submission.title}</CardTitle>
            <CardDescription>
              Updated {formatMediumDateTime(submission.updatedAt)}
            </CardDescription>
            <CardAction>
              <SubmissionStatusBadge status={submission.status} />
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <span>Template revision {submission.templateRevision}</span>
            <span>
              {submission.createdBy === currentUserId
                ? "Created by you"
                : "Created by a team member"}
            </span>
          </CardContent>
          <CardFooter>
            <Link
              className={cn(buttonVariants({ variant: "outline" }))}
              href={`/submissions/${encodeURIComponent(submission.id)}`}
            >
              {submission.status === "draft" ? "Open draft" : "View submission"}
            </Link>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
