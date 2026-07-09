import { Archive, FileText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { DocumentDownloadButton } from "@/components/documents/document-download-button"
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
import { getDocumentDetail } from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import type { DocumentDetail, DocumentVersion } from "@/types/document"
import type { OrganizationContext } from "@/types/organization"

import { archiveDocumentAction } from "../actions"

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
  const user = await loadDocumentDetailUser(documentId)
  const { context, errorMessage: contextErrorMessage } =
    await getCurrentOrganizationContext(user.id)
      .then((context) => ({ context, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load organization context."
        )

        console.warn("document_detail_context_load_failed", {
          userId: user.id,
          documentId,
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

  return (
    <DocumentDetailShell params={query}>
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
        <div className="flex flex-col gap-4">
          <DocumentMetadataCard context={context} detail={detail} />
          <VersionListCard versions={detail.versions} />
        </div>
        <DocumentActionsCard context={context} detail={detail} />
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
        <MetadataItem label="Created" value={formatDateTime(detail.document.createdAt)} />
        <MetadataItem
          label="Updated"
          value={formatDateTime(detail.document.updatedAt)}
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
              ? `Archived ${formatDateTime(detail.document.archivedAt)}`
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
  versions,
}: {
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
                  </div>
                </div>
                <div className="flex flex-col items-start gap-1 md:items-end">
                  <Badge variant={version.status === "available" ? "secondary" : "outline"}>
                    {version.status === "available" ? "Available" : "Pending"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    v{version.versionNumber}
                  </span>
                </div>
              </div>
            ))}
          </div>
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
        <CardDescription>Download or archive this document.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DocumentDownloadButton
          disabled={!detail.document.currentVersionId}
          documentId={detail.document.id}
          organizationId={context.organization.id}
        />
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

async function loadDocumentDetailUser(documentId: string): Promise<AuthenticatedUser> {
  try {
    return await getAuthenticatedUser()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: `/documents/${documentId}` }))
    }

    throw error
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
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

function getPageErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
