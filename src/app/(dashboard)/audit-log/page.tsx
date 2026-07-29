import { redirect } from "next/navigation"
import { cache, Suspense, type ReactElement, type ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatMediumDateTime } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listAuditLogs, verifyAuditLogChain } from "@/services/audit-service"
import type { AuditChainVerification, AuditLogEntry } from "@/types/audit"

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

export default async function AuditLogPage(): Promise<ReactElement> {
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

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing audit logs.",
      })
    )
  }

  if (!canPerformOrganizationAction(context.membership.role, "audit_logs:view")) {
    redirect(
      buildRedirect("/dashboard", {
        error: "You cannot view audit logs.",
      })
    )
  }

  const { entries, errorMessage: entriesErrorMessage } = await listAuditLogs({
    actorUserId: user.id,
    organizationId: context.organization.id,
  })
    .then((entries) => ({ entries, errorMessage: null as string | null }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(error, "Unable to load audit logs.")

      console.warn("audit_log_entries_load_failed", {
        userId: user.id,
        organizationId: context.organization.id,
        reason: errorMessage,
      })

      return {
        entries: null,
        errorMessage,
      }
    })

  if (!entries) {
    return (
      <AuditLogShell>
        <Alert variant="destructive">
          <AlertTitle>Audit log unavailable</AlertTitle>
          <AlertDescription>{entriesErrorMessage}</AlertDescription>
        </Alert>
      </AuditLogShell>
    )
  }

  const canVerifyChain = canPerformOrganizationAction(
    context.membership.role,
    "audit_logs:verify"
  )

  return (
    <AuditLogShell>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Audit Log</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Review administrative events for {context.organization.name}.
        </p>
      </section>

      {canVerifyChain ? (
        <Suspense fallback={null}>
          <AuditChainFailureAlert
            actorUserId={user.id}
            organizationId={context.organization.id}
          />
        </Suspense>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>
            Server-side audit events from organization and people workflows.
          </CardDescription>
          {canVerifyChain ? (
            <Suspense fallback={null}>
              <AuditChainVerifiedBadge
                actorUserId={user.id}
                organizationId={context.organization.id}
              />
            </Suspense>
          ) : null}
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <Alert>
              <AlertTitle>No audit events yet</AlertTitle>
              <AlertDescription>
                Organization, invite, and role changes will appear here.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map((entry: AuditLogEntry) => (
                <AuditLogEntryRow entry={entry} key={entry.id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
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
 * Confirms how many entries passed the tamper-evidence check.
 *
 * @param props - Authenticated member and tenant identifiers.
 * @returns A verification badge, or nothing when the chain is not intact.
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
    <Badge variant="outline">
      Integrity verified · {verification.checkedCount}{" "}
      {verification.checkedCount === 1 ? "entry" : "entries"}
    </Badge>
  )
}

function AuditLogShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}

function AuditLogEntryRow({
  entry,
}: {
  entry: AuditLogEntry
}): ReactElement {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(0,1fr)_160px]">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{formatAction(entry.action)}</span>
          <Badge variant="outline">{entry.targetType}</Badge>
        </div>
        <span className="break-words text-xs text-muted-foreground">
          {formatMetadata(entry.metadata)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground md:text-right">
        {formatMediumDateTime(entry.createdAt)}
      </span>
    </div>
  )
}

function formatAction(action: string): string {
  return action
    .split(".")
    .map((part: string) => part.replaceAll("_", " "))
    .join(" ")
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata)

  if (entries.length === 0) {
    return "No metadata"
  }

  return entries
    .map(([key, value]: [string, unknown]) => `${key}: ${String(value)}`)
    .join(", ")
}
