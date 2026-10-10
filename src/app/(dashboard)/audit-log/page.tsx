import { redirect } from "next/navigation"
import { type ReactElement, type ReactNode } from "react"

import {
  auditLogListState,
  getAuditTargetTypes,
} from "@/components/audit/audit-log-view"
import { AuditLogWorkspace } from "@/components/audit/audit-log-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SetupIncomplete } from "@/components/ui/page-state"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getLastPage, type RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listAuditLogPage, type AuditLogPage } from "@/services/audit-service"
import { listOrganizationPeople } from "@/services/organization-service"
import { listSavedViews } from "@/services/organizations/saved-view-service"
import type { OrganizationMember } from "@/types/organization"
import type { Metadata } from "next"

/**
 * Lists one page of the organization's audit events, narrowed, ordered, and
 * paged by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns The audit log workspace, or a user-safe access or load failure.
 */
export const metadata: Metadata = { title: "Audit log" }

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}): Promise<ReactElement> {
  const query = await searchParams
  const user = await loadAuthenticatedPageUser("/audit-log")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "audit_log_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <AuditLogShell>
          <SetupIncomplete message={contextErrorMessage} />
        </AuditLogShell>
      )
    }

    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  if (!canPerformOrganizationAction(context.membership, "audit_logs:view")) {
    redirect(buildFeedbackRedirect("/dashboard", "permission_denied"))
  }

  const view = auditLogListState.parse(query)
  const [result, members, savedViews] = await Promise.all([
    listAuditLogPage({
      actorUserId: user.id,
      organizationId: context.organization.id,
      page: view.page,
      pageSize: view.pageSize,
      sort: view.sort,
      targetTypes: getAuditTargetTypes(view),
    })
      .then((auditPage: AuditLogPage) => ({ auditPage, errorMessage: null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load audit logs."
        )

        console.warn("audit_log_entries_load_failed", {
          userId: user.id,
          organizationId: context.organization.id,
          reason: errorMessage,
        })

        return { auditPage: null, errorMessage }
      }),
    listOrganizationPeople(user.id, context.organization.id)
      .then((people) => people.members)
      .catch((): OrganizationMember[] => []),
    listSavedViews({
      actorUserId: user.id,
      list: "audit-log",
      organizationId: context.organization.id,
    }).catch(() => []),
  ])

  if (result.auditPage === null) {
    return (
      <AuditLogShell>
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          Audit log
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Audit log unavailable</AlertTitle>
          <AlertDescription>{result.errorMessage}</AlertDescription>
        </Alert>
      </AuditLogShell>
    )
  }

  const lastPage = getLastPage(result.auditPage.total, view.pageSize)

  // A stale link past the end opens the last page that still has events.
  if (view.page > lastPage) {
    redirect(auditLogListState.href("/audit-log", view, { page: lastPage }))
  }

  return (
    <AuditLogShell>
      <AuditLogWorkspace
        entries={result.auditPage.entries}
        members={members}
        savedViews={savedViews}
        total={result.auditPage.total}
        view={view}
      />
    </AuditLogShell>
  )
}

function AuditLogShell({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}
