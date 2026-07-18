import { ArrowLeft, Download, Save } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { DocumentRecipientCollection } from "@/components/documents/document-recipient-collection"
import { GeneratedDocumentContent } from "@/components/documents/generated-document-content"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import {
  SigningRecipientStatusBadge,
  SigningWorkflowBadge,
} from "@/lib/page-status-badges"
import {
  canPerformOrganizationAction,
  type OrganizationRole,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { getGeneratedDocumentSigningView } from "@/services/document-signing-service"
import type {
  DocumentSigningRecipient,
  GeneratedDocumentSigningView,
} from "@/types/signing"
import type {
  GeneratedDocumentWorkflowStatus,
} from "@/types/template"

import {
  resendGeneratedDocumentInvitationAction,
  saveGeneratedDocumentAction,
  sendGeneratedDocumentAction,
} from "./actions"

export const dynamic = "force-dynamic"

type GeneratedDocumentEditorParams = Promise<{
  documentId: string
}>

type GeneratedDocumentEditorSearchParams = Promise<{
  error?: string
  message?: string
}>

/**
 * Loads the authenticated generated-document editor and signing controls.
 *
 * @param props - Document route id and optional action feedback.
 * @returns A permission-aware member editor with recipients and PDF access.
 */
export default async function GeneratedDocumentEditorPage({
  params,
  searchParams,
}: {
  params: GeneratedDocumentEditorParams
  searchParams: GeneratedDocumentEditorSearchParams
}): Promise<ReactElement> {
  const [{ documentId }, query] = await Promise.all([params, searchParams])
  const editorPath = `/documents/${encodeURIComponent(documentId)}/edit`
  const user = await loadAuthenticatedPageUser(editorPath)
  const contextResult = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "generated_document_editor_context_load_failed",
    failureDetails: { documentId },
  })

  if (!contextResult.context) {
    if (contextResult.errorMessage) {
      return (
        <GeneratedDocumentEditorShell query={query}>
          <Alert variant="destructive">
            <AlertTitle>Document editor unavailable</AlertTitle>
            <AlertDescription>{contextResult.errorMessage}</AlertDescription>
          </Alert>
        </GeneratedDocumentEditorShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing documents.",
      })
    )
  }

  const context = contextResult.context
  const viewResult = await getGeneratedDocumentSigningView({
    actorUserId: user.id,
    organizationId: context.organization.id,
    documentId,
  })
    .then((view: GeneratedDocumentSigningView) => ({
      view,
      errorMessage: null as string | null,
    }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(
        error,
        "Unable to load generated document."
      )

      console.warn("generated_document_editor_load_failed", {
        documentId,
        organizationId: context.organization.id,
        reason: errorMessage,
        userId: user.id,
      })
      return { view: null, errorMessage }
    })

  if (!viewResult.view) {
    return (
      <GeneratedDocumentEditorShell query={query}>
        <Alert variant="destructive">
          <AlertTitle>Generated document unavailable</AlertTitle>
          <AlertDescription>{viewResult.errorMessage}</AlertDescription>
        </Alert>
      </GeneratedDocumentEditorShell>
    )
  }

  const view = viewResult.view
  const canFill = canPerformOrganizationAction(
    context.membership.role,
    "documents:fill"
  )
  const canSend = canPerformOrganizationAction(
    context.membership.role,
    "documents:send"
  )
  const isCompleted = view.workflowStatus === "completed"
  const documentsHref = view.document.folderId
    ? `/documents?folderId=${encodeURIComponent(view.document.folderId)}`
    : "/documents"

  return (
    <GeneratedDocumentEditorShell query={query}>
      <DocumentOpenTracker
        documentId={view.document.id}
        organizationId={context.organization.id}
      />

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "w-fit"
            )}
            href={documentsHref}
          >
            <ArrowLeft />
            Back to documents
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              {view.document.title}
            </h1>
            <SigningWorkflowBadge status={view.workflowStatus} />
          </div>
          {view.document.description && (
            <p className="max-w-2xl text-sm text-muted-foreground">
              {view.document.description}
            </p>
          )}
        </div>
        <a
          className={cn(buttonVariants({ variant: "outline" }))}
          href={`/api/documents/${encodeURIComponent(view.document.id)}/pdf`}
          rel="noreferrer"
          target="_blank"
        >
          <Download />
          {isCompleted ? "Download final PDF" : "Download preview PDF"}
        </a>
      </section>

      {isCompleted && (
        <Alert>
          <AlertTitle>Document complete</AlertTitle>
          <AlertDescription>
            Every signing party has signed. Answers are now read only and the
            final PDF includes the signer record. The same finalized file is
            reused for later downloads.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DocumentAnswersCard
          canFill={canFill}
          isCompleted={isCompleted}
          role={context.membership.role}
          view={view}
        />
        <aside className="flex min-w-0 flex-col gap-6">
          <SigningOverviewCard view={view} />
          <RecipientStatusCard
            canSend={canSend}
            role={context.membership.role}
            view={view}
          />
          {!isCompleted && (
            <RoleGuard action="documents:send" role={context.membership.role}>
              <DocumentRecipientCollection
                action={sendGeneratedDocumentAction}
                documentId={view.document.id}
              />
            </RoleGuard>
          )}
        </aside>
      </div>
    </GeneratedDocumentEditorShell>
  )
}

function DocumentAnswersCard({
  canFill,
  isCompleted,
  role,
  view,
}: {
  canFill: boolean
  isCompleted: boolean
  role: OrganizationRole
  view: GeneratedDocumentSigningView
}): ReactElement {
  const editable = canFill && !isCompleted

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Document content</CardTitle>
        <CardDescription>
          {editable
            ? "Complete fields and save progress before or during signing."
            : "Review the immutable document answers."}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">
            {editable ? "Editable" : "Read only"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="overflow-auto bg-muted/30 p-4 sm:p-6">
        <form action={saveGeneratedDocumentAction} id="document-answer-form">
          <input name="documentId" type="hidden" value={view.document.id} />
          <GeneratedDocumentContent
            answers={view.answers}
            content={view.document.templateSnapshot}
            editable={editable}
          />
        </form>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          Shared answers use the exact template snapshot saved with this document.
        </span>
        {editable && (
          <RoleGuard action="documents:fill" role={role}>
            <PermissionButton
              action="documents:fill"
              form="document-answer-form"
              role={role}
              type="submit"
            >
              <Save />
              Save answers
            </PermissionButton>
          </RoleGuard>
        )}
      </CardFooter>
    </Card>
  )
}

function SigningOverviewCard({
  view,
}: {
  view: GeneratedDocumentSigningView
}): ReactElement {
  const signedRecipients = view.recipients.filter(
    (recipient: DocumentSigningRecipient) => recipient.status === "signed"
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signing progress</CardTitle>
        <CardDescription>{view.organizationName}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <ProgressItem label="Workflow" value={formatWorkflow(view.workflowStatus)} />
        <ProgressItem
          label="Signatures"
          value={`${signedRecipients.length} of ${view.recipients.length}`}
        />
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          Required recipients may sign in any order.
        </span>
      </CardFooter>
    </Card>
  )
}

function RecipientStatusCard({
  canSend,
  role,
  view,
}: {
  canSend: boolean
  role: OrganizationRole
  view: GeneratedDocumentSigningView
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
        <CardDescription>Invitation and signature status.</CardDescription>
        <CardAction>
          <Badge variant="outline">{view.recipients.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {view.recipients.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="text-sm font-medium">No recipients yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add at least one recipient to start signing.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {view.recipients.map((recipient: DocumentSigningRecipient) => (
              <div
                className="flex flex-col gap-3 rounded-lg border bg-background p-3"
                key={recipient.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{recipient.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {recipient.email}
                    </p>
                  </div>
                  <SigningRecipientStatusBadge status={recipient.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <p>
                    Signature required
                  </p>
                  <p>
                    {recipient.signedAt
                      ? `Signed ${formatMediumDateTime(recipient.signedAt)}`
                      : `Link expires ${formatMediumDateTime(recipient.tokenExpiresAt)}`}
                  </p>
                </div>
                {canSend &&
                  recipient.status !== "signed" &&
                  view.workflowStatus !== "completed" && (
                    <form action={resendGeneratedDocumentInvitationAction}>
                      <input
                        name="documentId"
                        type="hidden"
                        value={view.document.id}
                      />
                      <input
                        name="recipientId"
                        type="hidden"
                        value={recipient.id}
                      />
                      <PermissionButton
                        action="documents:send"
                        role={role}
                        size="sm"
                        type="submit"
                        variant="outline"
                      >
                        Resend invitation
                      </PermissionButton>
                    </form>
                  )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <span className="text-xs text-muted-foreground">
          Resending immediately replaces the previous private link.
        </span>
      </CardFooter>
    </Card>
  )
}

function GeneratedDocumentEditorShell({
  children,
  query,
}: {
  children: ReactNode
  query: Awaited<GeneratedDocumentEditorSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {query.error && (
        <Alert variant="destructive">
          <AlertTitle>Document action failed</AlertTitle>
          <AlertDescription>{query.error}</AlertDescription>
        </Alert>
      )}
      {query.message && (
        <Alert>
          <AlertTitle>Document updated</AlertTitle>
          <AlertDescription>{query.message}</AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  )
}

function ProgressItem({
  label,
  value,
}: {
  label: string
  value: string
}): ReactElement {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  )
}

function formatWorkflow(status: GeneratedDocumentWorkflowStatus): string {
  if (status === "awaiting_signatures") {
    return "Awaiting signatures"
  }

  return status === "completed" ? "Completed" : "Draft"
}
