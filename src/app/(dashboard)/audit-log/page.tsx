import { ShieldCheck } from "lucide-react"
import { redirect } from "next/navigation"
import { cache, Suspense, type ReactElement, type ReactNode } from "react"

import {
  auditLogListState,
  getAuditTargetTypes,
} from "@/components/audit/audit-log-view"
import { AuditLogWorkspace } from "@/components/audit/audit-log-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { getLastPage, type RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import {
  listAuditLogPage,
  verifyAuditLogChain,
  type AuditLogPage,
} from "@/services/audit-service"
import { listOrganizationPeople } from "@/services/organization-service"
import type { AuditChainVerification } from "@/types/audit"
import type { OrganizationMember } from "@/types/organization"

// Chain verification walks every entry for the organization, so it streams in
// its own boundaries rather than delaying the event list. Keyed on primitives
// (an input object would defeat cache()'s identity-based memoization) so the
// badge and the failure alert share one round trip.
const getCachedChainVerification = cache(
  async (
    actorUserId: string,
    organizationId: string
  ): Promise<AuditChainVerification | null> =>
    verifyAuditLogChain({ actorUserId, organizationId }).catch(
      (error: unknown) => {
        console.warn("audit_log_chain_verification_failed", {
          userId: actorUserId,
          organizationId,
          reason: getPageErrorMessage(error, "Verification unavailable."),
        })
        return null
      }
    )
)

/**
 * Lists one page of the organization's audit events, narrowed, ordered, and
 * paged by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns The audit log workspace, or a user-safe access or load failure.
 */
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
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </AuditLogShell>
      )
    }

    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  if (!canPerformOrganizationAction(context.membership, "audit_logs:view")) {
    redirect(buildFeedbackRedirect("/dashboard", "permission_denied"))
  }

  const view = auditLogListState.parse(query)
  const [result, members] = await Promise.all([
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

  const canVerifyChain = canPerformOrganizationAction(
    context.membership,
    "audit_logs:verify"
  )

  return (
    <AuditLogShell>
      {canVerifyChain ? (
        <Suspense fallback={null}>
          <AuditChainFailureAlert
            actorUserId={user.id}
            organizationId={context.organization.id}
          />
        </Suspense>
      ) : null}
      <AuditLogWorkspace
        entries={result.auditPage.entries}
        integrity={
          canVerifyChain ? (
            <Suspense fallback={null}>
              <AuditChainVerifiedBadge
                actorUserId={user.id}
                organizationId={context.organization.id}
              />
            </Suspense>
          ) : null
        }
        members={members}
        total={result.auditPage.total}
        view={view}
      />
    </AuditLogShell>
  )
}

/**
 * Warns when the tamper-evidence chain fails verification.
 *
 * @param props - Authenticated member and tenant identifiers.
 * @returns A destructive alert, or nothing when the chain is intact.
 */
async function AuditChainFailureAlert({
  actorUserId,
  organizationId,
}: {
  actorUserId: string
  organizationId: string
}): Promise<ReactElement | null> {
  const verification = await getCachedChainVerification(
    actorUserId,
    organizationId
  )

  if (!verification || verification.valid) {
    return null
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>Audit chain integrity check failed</AlertTitle>
      <AlertDescription>
        The tamper-evidence check failed at entry #
        {verification.firstInvalidSeq ?? "unknown"} (
        {verification.failureReason ?? "unknown reason"}). Investigate before
        trusting this history.
      </AlertDescription>
    </Alert>
  )
}

/**
 * Marks the log as verified once every entry passed the tamper-evidence check.
 *
 * @param props - Authenticated member and tenant identifiers.
 * @returns A quiet verified mark, or nothing when the chain is not intact.
 */
async function AuditChainVerifiedBadge({
  actorUserId,
  organizationId,
}: {
  actorUserId: string
  organizationId: string
}): Promise<ReactElement | null> {
  const verification = await getCachedChainVerification(
    actorUserId,
    organizationId
  )

  if (!verification?.valid) {
    return null
  }

  return (
    <Badge className="font-normal text-muted-foreground" variant="outline">
      <ShieldCheck aria-hidden="true" />
      Verified
      <span className="sr-only">
        : the tamper-evidence check passed for {verification.checkedCount}{" "}
        {verification.checkedCount === 1 ? "entry" : "entries"}
      </span>
    </Badge>
  )
}

function AuditLogShell({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}
