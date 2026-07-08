import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { canPerformOrganizationAction } from "@/lib/permissions"
import { listAuditLogs } from "@/services/audit-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { AuditLogEntry } from "@/types/audit"

export default async function AuditLogPage(): Promise<ReactElement> {
  const user = await loadAuditLogUser()
  const { context, errorMessage: contextErrorMessage } =
    await getCurrentOrganizationContext(user.id)
      .then((context) => ({ context, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load organization context."
        )

        console.warn("audit_log_context_load_failed", {
          userId: user.id,
          reason: errorMessage,
        })

        return {
          context: null,
          errorMessage,
        }
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

  return (
    <AuditLogShell>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Audit Log</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Review administrative events for {context.organization.name}.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
          <CardDescription>
            Server-side audit events from organization and people workflows.
          </CardDescription>
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

function AuditLogShell({
  children,
}: {
  children: ReactElement | ReactElement[]
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
        {formatDateTime(entry.createdAt)}
      </span>
    </div>
  )
}

async function loadAuditLogUser(): Promise<AuthenticatedUser> {
  try {
    return await getAuthenticatedUser()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/audit-log" }))
    }

    throw error
  }
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function getPageErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
