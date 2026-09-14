import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import {
  getSubmissionViewAssignee,
  getSubmissionViewStatuses,
  submissionListState,
} from "@/components/submissions/submission-list-view"
import { SubmissionsWorkspace } from "@/components/submissions/submissions-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getLastPage, type RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listOrganizationPeople } from "@/services/organization-service"
import {
  listSubmissionPage,
  type SubmissionPage,
} from "@/services/submission-service"
import type { OrganizationMember } from "@/types/organization"

type SubmissionsSearchParams = Promise<RawSearchParams>

/**
 * Lists one page of the submissions the member may see, searched, filtered,
 * sorted, and paged by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns The Submissions workspace, or a user-safe access or load failure.
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
        <SubmissionsShell>
          <Alert variant="destructive">
            <AlertTitle>Submissions unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </SubmissionsShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const context = contextResult.context
  const canAssign = canPerformOrganizationAction(
    context.membership,
    "submissions:assign"
  )
  const view = submissionListState.parse(query)
  const [result, members] = await Promise.all([
    listSubmissionPage({
      actorUserId: user.id,
      assignedTo: getSubmissionViewAssignee(view),
      organizationId: context.organization.id,
      page: view.page,
      pageSize: view.pageSize,
      query: view.query || undefined,
      sort: view.sort,
      statuses: getSubmissionViewStatuses(view),
    })
      .then((submissionPage: SubmissionPage) => ({
        errorMessage: null,
        submissionPage,
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
        return { errorMessage, submissionPage: null }
      }),
    // Only people who assign reviews see assignees, so only they need names.
    canAssign
      ? listOrganizationPeople(user.id, context.organization.id)
          .then((people) => people.members)
          .catch((error: unknown) => {
            console.warn("submissions_people_load_failed", {
              organizationId: context.organization.id,
              reason: getPageErrorMessage(
                error,
                "Unable to load reviewer names."
              ),
              userId: user.id,
            })
            return [] as OrganizationMember[]
          })
      : Promise.resolve([] as OrganizationMember[]),
  ])

  if (result.submissionPage === null) {
    return (
      <SubmissionsShell>
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          Submissions
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Submission list unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </SubmissionsShell>
    )
  }

  const lastPage = getLastPage(result.submissionPage.total, view.pageSize)

  // A stale link past the end opens the last page that still has submissions.
  if (view.page > lastPage) {
    redirect(submissionListState.href("/submissions", view, { page: lastPage }))
  }

  return (
    <SubmissionsShell>
      <SubmissionsWorkspace
        canAssign={canAssign}
        canCreate={canPerformOrganizationAction(
          context.membership,
          "submissions:create"
        )}
        currentUserId={user.id}
        members={members}
        organizationId={context.organization.id}
        submissions={result.submissionPage.submissions}
        total={result.submissionPage.total}
        view={view}
      />
    </SubmissionsShell>
  )
}

function SubmissionsShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}
