import { ChevronRight, FileText, Folder, Plus } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  formatMediumDate,
  formatMediumDateTime,
} from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { buildDocumentFolderPath } from "@/lib/page-document-folders"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { listDocumentWorkspace } from "@/services/document-service"
import { listRecentDocuments } from "@/services/template-service"
import type { DocumentFolder, DocumentSummary } from "@/types/document"
import type { OrganizationContext } from "@/types/organization"
import type { RecentDocument } from "@/types/template"

import { createFolderAction } from "./actions"

type DocumentsSearchParams = Promise<{
  error?: string
  folderId?: string
  message?: string
}>

/**
 * Renders recent documents plus the current folder's navigable contents.
 *
 * @param props - Optional status messages and active folder query parameter.
 * @returns Tenant-scoped Documents workspace.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: DocumentsSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/documents")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "documents_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <DocumentsShell params={params}>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </DocumentsShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before managing documents.",
      })
    )
  }

  const [workspaceResult, recentResult] = await Promise.allSettled([
    listDocumentWorkspace({
      actorUserId: user.id,
      organizationId: context.organization.id,
    }),
    listRecentDocuments({
      actorUserId: user.id,
      organizationId: context.organization.id,
      limit: 6,
    }),
  ])

  if (workspaceResult.status === "rejected") {
    const errorMessage = getPageErrorMessage(
      workspaceResult.reason,
      "Unable to load documents."
    )
    console.warn("documents_workspace_load_failed", {
      userId: user.id,
      organizationId: context.organization.id,
      reason: errorMessage,
    })
    return (
      <DocumentsShell params={params}>
        <Alert variant="destructive">
          <AlertTitle>Documents unavailable</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      </DocumentsShell>
    )
  }

  const workspace = workspaceResult.value
  const recentDocuments =
    recentResult.status === "fulfilled" ? recentResult.value : []

  if (recentResult.status === "rejected") {
    console.warn("recent_documents_load_failed", {
      userId: user.id,
      organizationId: context.organization.id,
      reason: getPageErrorMessage(
        recentResult.reason,
        "Unable to load recent documents."
      ),
    })
  }

  const activeFolder = params.folderId
    ? workspace.folders.find(
        (folder: DocumentFolder): boolean => folder.id === params.folderId
      ) ?? null
    : null

  if (params.folderId && !activeFolder) {
    return (
      <DocumentsShell params={params}>
        <Alert variant="destructive">
          <AlertTitle>Folder unavailable</AlertTitle>
          <AlertDescription>
            This folder does not exist or is no longer active.
          </AlertDescription>
        </Alert>
        <Link className="text-sm font-medium underline" href="/documents">
          Return to Documents
        </Link>
      </DocumentsShell>
    )
  }

  const activeFolderId = activeFolder?.id ?? null
  const folders = workspace.folders.filter(
    (folder: DocumentFolder): boolean =>
      folder.parentFolderId === activeFolderId
  )
  const documents = workspace.documents.filter(
    (document: DocumentSummary): boolean =>
      document.folderId === activeFolderId
  )
  const breadcrumbs = buildDocumentFolderPath(
    activeFolder,
    workspace.folders
  )

  return (
    <DocumentsShell params={params}>
      <section className="flex flex-col gap-3">
        <DocumentBreadcrumbs folders={breadcrumbs} />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-normal">
            {activeFolder?.name ?? "Documents"}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Recently opened documents and organized files for{" "}
            {context.organization.name}.
          </p>
        </div>
      </section>

      <RecentDocumentsCard documents={recentDocuments} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <FolderContentsCard
          activeFolder={activeFolder}
          documents={documents}
          folders={folders}
          role={context.membership.role}
        />
        <RoleGuard role={context.membership.role} action="folders:manage">
          <CreateFolderCard
            activeFolderId={activeFolderId}
            organizationId={context.organization.id}
            role={context.membership.role}
          />
        </RoleGuard>
      </div>
    </DocumentsShell>
  )
}

function DocumentsShell({
  children,
  params,
}: {
  children: ReactNode
  params: Awaited<DocumentsSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error ? (
        <Alert variant="destructive">
          <AlertTitle>Documents action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      ) : null}
      {params.message ? (
        <Alert>
          <AlertTitle>Documents updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      ) : null}
      {children}
    </div>
  )
}

function DocumentBreadcrumbs({
  folders,
}: {
  folders: DocumentFolder[]
}): ReactElement {
  return (
    <nav aria-label="Document folder path">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link className="transition-colors hover:text-foreground" href="/documents">
            Documents
          </Link>
        </li>
        {folders.map((folder: DocumentFolder) => (
          <li className="flex items-center gap-1" key={folder.id}>
            <ChevronRight aria-hidden="true" className="size-4" />
            <Link
              className="transition-colors hover:text-foreground"
              href={getFolderHref(folder.id)}
            >
              {folder.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function RecentDocumentsCard({
  documents,
}: {
  documents: RecentDocument[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent documents</CardTitle>
        <CardDescription>
          The documents you opened most recently, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Open a document and it will appear here.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {documents.map((document: RecentDocument) => (
              <Link
                className="flex min-w-0 gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50"
                href={getDocumentHref(document.documentId, document.sourceKind)}
                key={document.documentId}
              >
                <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium">
                    {document.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Opened {formatMediumDateTime(document.lastOpenedAt)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FolderContentsCard({
  activeFolder,
  documents,
  folders,
  role,
}: {
  activeFolder: DocumentFolder | null
  documents: DocumentSummary[]
  folders: DocumentFolder[]
  role: OrganizationContext["membership"]["role"]
}): ReactElement {
  const addDocumentHref = activeFolder
    ? `/documents/new?folderId=${encodeURIComponent(activeFolder.id)}`
    : "/documents/new"

  return (
    <Card>
      <CardHeader>
        <CardTitle>{activeFolder ? "Folder contents" : "Files and folders"}</CardTitle>
        <CardDescription>
          Open a folder or document, or add a document in this location.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {folders.map((folder: DocumentFolder) => (
            <Link
              className="flex items-center gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50"
              href={getFolderHref(folder.id)}
              key={folder.id}
            >
              <Folder className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{folder.name}</span>
            </Link>
          ))}
          {documents.map((document: DocumentSummary) => (
            <Link
              className="flex min-w-0 items-start gap-3 rounded-xl border bg-background p-4 transition-colors hover:bg-muted/50"
              href={getDocumentHref(
                document.id,
                document.sourceKind ?? "upload"
              )}
              key={document.id}
            >
              <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium">
                  {document.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  Updated {formatMediumDate(document.updatedAt)}
                </span>
              </span>
              <Badge variant="outline">
                {document.sourceKind === "generated" ? "Editable" : "File"}
              </Badge>
            </Link>
          ))}
          <RoleGuard role={role} action="documents:create">
            <Link
              aria-label="Add a document in this folder"
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 p-4 text-center text-sm font-medium transition-colors hover:bg-muted/60"
              href={addDocumentHref}
            >
              <span className="flex size-9 items-center justify-center rounded-full border bg-background">
                <Plus aria-hidden="true" className="size-5" />
              </span>
              Add document
            </Link>
          </RoleGuard>
        </div>
        {folders.length === 0 && documents.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            This location is empty.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function CreateFolderCard({
  activeFolderId,
  organizationId,
  role,
}: {
  activeFolderId: string | null
  organizationId: string
  role: OrganizationContext["membership"]["role"]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{activeFolderId ? "Create subfolder" : "Create folder"}</CardTitle>
        <CardDescription>
          Add a folder in the current location.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createFolderAction} className="flex flex-col gap-5">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input
            type="hidden"
            name="parentFolderId"
            value={activeFolderId ?? ""}
          />
          <input
            type="hidden"
            name="returnFolderId"
            value={activeFolderId ?? ""}
          />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="folder-name">Folder name</FieldLabel>
              <Input
                id="folder-name"
                maxLength={120}
                minLength={1}
                name="name"
                required
                type="text"
              />
            </Field>
          </FieldGroup>
          <PermissionButton action="folders:manage" role={role} type="submit">
            Create folder
          </PermissionButton>
        </form>
      </CardContent>
    </Card>
  )
}

function getFolderHref(folderId: string): string {
  return `/documents?folderId=${encodeURIComponent(folderId)}`
}

function getDocumentHref(
  documentId: string,
  sourceKind: "upload" | "generated"
): string {
  return sourceKind === "generated"
    ? `/documents/${encodeURIComponent(documentId)}/edit`
    : `/documents/${encodeURIComponent(documentId)}`
}
