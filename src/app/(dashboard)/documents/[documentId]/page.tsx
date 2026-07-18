import { Archive, FileText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { DocumentCommentSubmitButton } from "@/components/documents/document-comment-submit-button"
import { DocumentDownloadButton } from "@/components/documents/document-download-button"
import { DocumentOpenTracker } from "@/components/documents/document-open-tracker"
import { DocumentReplaceForm } from "@/components/documents/document-replace-form"
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
import { getDocumentDetail } from "@/services/document-service"
import { listDocumentActivity } from "@/services/document-activity-service"
import { listDocumentComments } from "@/services/document-comment-service"
import type { DocumentActivityEvent } from "@/types/activity"
import type { DocumentComment } from "@/types/comment"
import type { DocumentDetail, DocumentVersion } from "@/types/document"
import type { OrganizationContext } from "@/types/organization"

import {
  archiveDocumentAction,
  createDocumentCommentAction,
} from "../actions"

type DocumentDetailParams = Promise<{
  documentId: string
}>

type DocumentDetailSearchParams = Promise<{
  error?: string
  message?: string
}>

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: DocumentDetailParams
  searchParams: DocumentDetailSearchParams
}): Promise<ReactElement> {
  const { documentId } = await params
  const query = await searchParams
  const user = await loadAuthenticatedPageUser(`/documents/${documentId}`)
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "document_detail_context_load_failed",
      failureDetails: { documentId },
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <DocumentDetailShell params={query}>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </DocumentDetailShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before viewing documents.",
      })
    )
  }

  const { detail, errorMessage: detailErrorMessage } = await getDocumentDetail({
    actorUserId: user.id,
    organizationId: context.organization.id,
    documentId,
  })
    .then((detail) => ({ detail, errorMessage: null as string | null }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(
        error,
        "Unable to load document detail."
      )

      console.warn("document_detail_load_failed", {
        userId: user.id,
        organizationId: context.organization.id,
        documentId,
        reason: errorMessage,
      })

      return {
        detail: null,
        errorMessage,
      }
    })

  if (!detail) {
    return (
      <DocumentDetailShell params={query}>
        <Alert variant="destructive">
          <AlertTitle>Document unavailable</AlertTitle>
          <AlertDescription>{detailErrorMessage}</AlertDescription>
        </Alert>
      </DocumentDetailShell>
    )
  }

  if (detail.document.sourceKind === "generated") {
    redirect(`/documents/${encodeURIComponent(detail.document.id)}/edit`)
  }

  const [commentsResult, activityResult] = await Promise.all([
    listDocumentComments({
      actorUserId: user.id,
      organizationId: context.organization.id,
      documentId: detail.document.id,
    })
      .then((comments) => ({ comments, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load document comments."
        )

        console.warn("document_comments_load_failed", {
          userId: user.id,
          organizationId: context.organization.id,
          documentId: detail.document.id,
          reason: errorMessage,
        })

        return { comments: [] as DocumentComment[], errorMessage }
      }),
    listDocumentActivity({
      actorUserId: user.id,
      organizationId: context.organization.id,
      documentId: detail.document.id,
    })
      .then((events) => ({ events, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load document activity."
        )

        console.warn("document_activity_load_failed", {
          userId: user.id,
          organizationId: context.organization.id,
          documentId: detail.document.id,
          reason: errorMessage,
        })

        return { events: [] as DocumentActivityEvent[], errorMessage }
      }),
  ])

  return (
    <DocumentDetailShell params={query}>
      <DocumentOpenTracker
        documentId={detail.document.id}
        organizationId={context.organization.id}
      />
      <section className="flex flex-col gap-2">
        <Link
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          href="/documents"
        >
          Back to documents
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">
            {detail.document.title}
          </h1>
          <Badge variant={detail.document.archivedAt ? "outline" : "secondary"}>
            {detail.document.archivedAt ? "Archived" : "Active"}
          </Badge>
        </div>
        {detail.document.description && (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {detail.document.description}
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-1 lg:order-0">
            <DocumentMetadataCard context={context} detail={detail} />
          </div>
          <div className="order-3 lg:order-0">
            <VersionListCard
              currentVersionId={detail.document.currentVersionId}
              documentId={detail.document.id}
              organizationId={context.organization.id}
              versions={detail.versions}
            />
          </div>
          <div className="order-5 lg:order-0">
            <DocumentActivityCard
              errorMessage={activityResult.errorMessage}
              events={activityResult.events}
            />
          </div>
        </div>
        <div className="contents lg:flex lg:flex-col lg:gap-4">
          <div className="order-2 lg:order-0">
            <DocumentActionsCard context={context} detail={detail} />
          </div>
          <div className="order-4 lg:order-0">
            <DocumentCommentsCard
              comments={commentsResult.comments}
              context={context}
              detail={detail}
              errorMessage={commentsResult.errorMessage}
            />
          </div>
        </div>
      </div>
    </DocumentDetailShell>
  )
}

function DocumentDetailShell({
  children,
  params,
}: {
  children: ReactElement | ReactElement[]
  params: Awaited<DocumentDetailSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Document action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      {params.message && (
        <Alert>
          <AlertTitle>Document updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}

      {children}
    </div>
  )
}

function DocumentMetadataCard({
  context,
  detail,
}: {
  context: OrganizationContext
  detail: DocumentDetail
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Metadata</CardTitle>
        <CardDescription>{context.organization.name}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-3">
        <MetadataItem
          label="Created"
          value={formatMediumDateTime(detail.document.createdAt)}
        />
        <MetadataItem
          label="Updated"
          value={formatMediumDateTime(detail.document.updatedAt)}
        />
        <MetadataItem
          label="Current version"
          value={detail.document.currentVersionId ? "Available" : "Pending"}
        />
        <MetadataItem label="Document id" value={detail.document.id} />
        <MetadataItem label="Folder id" value={detail.document.folderId ?? "No folder"} />
        <MetadataItem
          label="Archive status"
          value={
            detail.document.archivedAt
              ? `Archived ${formatMediumDateTime(detail.document.archivedAt)}`
              : "Active"
          }
        />
      </CardContent>
    </Card>
  )
}

function MetadataItem({
  label,
  value,
}: {
  label: string
  value: string
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words text-sm font-medium">{value}</span>
    </div>
  )
}

function VersionListCard({
  currentVersionId,
  documentId,
  organizationId,
  versions,
}: {
  currentVersionId: string | null
  documentId: string
  organizationId: string
  versions: DocumentVersion[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Versions</CardTitle>
        <CardDescription>File history for this document.</CardDescription>
      </CardHeader>
      <CardContent>
        {versions.length === 0 ? (
          <Alert>
            <AlertTitle>No versions yet</AlertTitle>
            <AlertDescription>No file metadata is available.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            {versions.map((version: DocumentVersion) => (
              <div
                className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(0,1fr)_140px]"
                key={version.id}
              >
                <div className="flex min-w-0 gap-3">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium">
                      {version.originalFilename}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {version.contentType} · {formatBytes(version.byteSize)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added {formatMediumDateTime(version.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 md:items-end">
                  <Badge variant={version.status === "available" ? "secondary" : "outline"}>
                    {version.id === currentVersionId
                      ? "Current"
                      : version.status === "available"
                        ? "Previous"
                        : "Pending"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    v{version.versionNumber}
                  </span>
                  {version.status === "available" && (
                    <DocumentDownloadButton
                      documentId={documentId}
                      label={`Download v${version.versionNumber}`}
                      organizationId={organizationId}
                      versionId={version.id}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentActivityCard({
  errorMessage,
  events,
}: {
  errorMessage: string | null
  events: DocumentActivityEvent[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Recent changes to this document.</CardDescription>
      </CardHeader>
      <CardContent>
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Activity unavailable</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {events.map((event: DocumentActivityEvent) => (
              <div
                className="flex flex-col gap-1 rounded-lg border bg-background p-3"
                key={event.id}
              >
                <p className="text-sm">
                  <span className="font-medium">{event.actorDisplayName}</span>{" "}
                  {formatActivityDescription(event)}
                </p>
                <span className="text-xs text-muted-foreground">
                  {formatMediumDateTime(event.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentCommentsCard({
  comments,
  context,
  detail,
  errorMessage,
}: {
  comments: DocumentComment[]
  context: OrganizationContext
  detail: DocumentDetail
  errorMessage: string | null
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments</CardTitle>
        <CardDescription>Keep document discussion with the file.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Comments unavailable</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div
            aria-label="Document comments"
            className="flex max-h-80 flex-col gap-3 overflow-y-auto"
            role="region"
            tabIndex={0}
          >
            {comments.map((comment: DocumentComment) => (
              <div
                className="flex flex-col gap-1 rounded-lg border bg-background p-3"
                key={comment.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {comment.authorDisplayName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatMediumDateTime(comment.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {comment.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {!detail.document.archivedAt && (
          <RoleGuard
            action="document_comments:create"
            role={context.membership.role}
          >
            <form action={createDocumentCommentAction} className="flex flex-col gap-3">
              <input
                name="organizationId"
                type="hidden"
                value={context.organization.id}
              />
              <input
                name="documentId"
                type="hidden"
                value={detail.document.id}
              />
              <label className="text-sm font-medium" htmlFor="document-comment">
                Add comment
              </label>
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                id="document-comment"
                maxLength={2000}
                name="body"
                placeholder="Share context or a review note"
                required
              />
              <DocumentCommentSubmitButton role={context.membership.role} />
            </form>
          </RoleGuard>
        )}
      </CardContent>
    </Card>
  )
}

function DocumentActionsCard({
  context,
  detail,
}: {
  context: OrganizationContext
  detail: DocumentDetail
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>Download, replace, or archive this document.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DocumentDownloadButton
          disabled={!detail.document.currentVersionId}
          documentId={detail.document.id}
          organizationId={context.organization.id}
        />
        {!detail.document.archivedAt && (
          <RoleGuard
            role={context.membership.role}
            action="document_versions:create"
          >
            <DocumentReplaceForm
              documentId={detail.document.id}
              organizationId={context.organization.id}
            />
          </RoleGuard>
        )}
        <RoleGuard role={context.membership.role} action="documents:archive">
          <form action={archiveDocumentAction}>
            <input
              type="hidden"
              name="organizationId"
              value={context.organization.id}
            />
            <input type="hidden" name="documentId" value={detail.document.id} />
            <PermissionButton
              action="documents:archive"
              disabled={Boolean(detail.document.archivedAt)}
              role={context.membership.role}
              type="submit"
              variant="destructive"
            >
              <Archive data-icon="inline-start" />
              Archive
            </PermissionButton>
          </form>
        </RoleGuard>
      </CardContent>
    </Card>
  )
}

function formatActivityDescription(event: DocumentActivityEvent): string {
  const versionNumber = event.metadata.versionNumber

  if (event.eventType === "document.uploaded") {
    return "uploaded the first version."
  }

  if (event.eventType === "document.replaced") {
    return typeof versionNumber === "number"
      ? `uploaded version ${versionNumber}.`
      : "uploaded a replacement version."
  }

  if (event.eventType === "document.commented") {
    return "added a comment."
  }

  if (event.eventType === "document.finalized") {
    return typeof versionNumber === "number"
      ? `finalized version ${versionNumber}.`
      : "finalized the generated PDF."
  }

  return "archived the document."
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
