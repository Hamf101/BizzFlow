import {
  Archive,
  ChevronRight,
  FileText,
  Folder,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Suspense, type ReactElement, type ReactNode } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { PurgeRequestForm } from "@/components/documents/purge-request-form"
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
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentFolder,
  DocumentLifecycleState,
} from "@/types/document"
import type { OrganizationContext } from "@/types/organization"
import type { RecentDocument } from "@/types/template"

import {
  archiveFolderAction,
  createFolderAction,
  requestFolderPurgeAction,
  restoreFolderAction,
  trashFolderAction,
} from "./actions"

type DocumentsSearchParams = Promise<{
  error?: string
  folderId?: string
  message?: string
  view?: string
}>

type WorkspaceView = "active" | "archived" | "trash"

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
  const workspaceView = parseWorkspaceView(params.view)
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

  // Recent documents load in their own Suspense boundary below, so the folder
  // tree is the only fetch this page waits on before painting.
  let workspace: Awaited<ReturnType<typeof listDocumentWorkspace>>

  try {
    workspace = await listDocumentWorkspace({
      actorUserId: user.id,
      organizationId: context.organization.id,
      lifecycleState:
        workspaceView === "trash" ? "trashed" : workspaceView,
    })
  } catch (error: unknown) {
    const errorMessage = getPageErrorMessage(error, "Unable to load documents.")

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

  const activeFolder = params.folderId
    ? workspace.folders.find(
        (folder: AccessibleDocumentFolder): boolean =>
          folder.id === params.folderId
      ) ?? null
    : null

  if (params.folderId && !activeFolder) {
    return (
      <DocumentsShell params={params}>
        <Alert variant="destructive">
          <AlertTitle>Folder unavailable</AlertTitle>
          <AlertDescription>
            This folder does not exist or is not available in the selected
            lifecycle view.
          </AlertDescription>
        </Alert>
        <Link
          className="text-sm font-medium underline"
          href={getWorkspaceHref(workspaceView)}
        >
          Return to Documents
        </Link>
      </DocumentsShell>
    )
  }

  const activeFolderId = activeFolder?.id ?? null
  const folders = workspace.folders.filter(
    (folder: AccessibleDocumentFolder): boolean =>
      folder.parentFolderId === activeFolderId
  )
  const documents = workspace.documents.filter(
    (document: AccessibleDocumentSummary): boolean =>
      document.folderId === activeFolderId
  )
  const breadcrumbs = buildDocumentFolderPath(
    activeFolder,
    workspace.folders
  )

  return (
    <DocumentsShell params={params}>
      <section className="flex flex-col gap-3">
        <WorkspaceNavigation activeView={workspaceView} />
        <DocumentBreadcrumbs
          folders={breadcrumbs}
          workspaceView={workspaceView}
        />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              {activeFolder?.name ?? getWorkspaceTitle(workspaceView)}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {getWorkspaceDescription(
                workspaceView,
                context.organization.name
              )}
            </p>
          </div>
          {activeFolder ? (
            <FolderLifecycleActions
              folder={activeFolder}
              organizationId={context.organization.id}
              returnFolderId={activeFolder.parentFolderId}
              role={context.membership.role}
              workspaceView={workspaceView}
            />
          ) : null}
        </div>
      </section>

      {workspaceView === "active" ? (
        <Suspense fallback={<RecentDocumentsSkeleton />}>
          <RecentDocumentsSection
            actorUserId={user.id}
            organizationId={context.organization.id}
          />
        </Suspense>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <FolderContentsCard
          activeFolder={activeFolder}
          documents={documents}
          folders={folders}
          organizationId={context.organization.id}
          role={context.membership.role}
          workspaceView={workspaceView}
        />
        {workspaceView === "active" &&
        (!activeFolder || activeFolder.accessLevel === "contributor") ? (
          <RoleGuard role={context.membership.role} action="folders:manage">
            <CreateFolderCard
              activeFolderId={activeFolderId}
              organizationId={context.organization.id}
              role={context.membership.role}
            />
          </RoleGuard>
        ) : null}
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
  workspaceView,
}: {
  folders: DocumentFolder[]
  workspaceView: WorkspaceView
}): ReactElement {
  return (
    <nav aria-label="Document folder path">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link
            className="transition-colors hover:text-foreground"
            href={getWorkspaceHref(workspaceView)}
          >
            Documents
          </Link>
        </li>
        {folders.map((folder: DocumentFolder) => (
          <li className="flex items-center gap-1" key={folder.id}>
            <ChevronRight aria-hidden="true" className="size-4" />
            <Link
              className="transition-colors hover:text-foreground"
              href={getFolderHref(folder.id, workspaceView)}
            >
              {folder.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function WorkspaceNavigation({
  activeView,
}: {
  activeView: WorkspaceView
}): ReactElement {
  const views: Array<{ label: string; value: WorkspaceView }> = [
    { label: "Active", value: "active" },
    { label: "Archived", value: "archived" },
    { label: "Trash", value: "trash" },
  ]

  return (
    <nav aria-label="Document lifecycle views">
      <div className="flex flex-wrap gap-2">
        {views.map(
          (view: { label: string; value: WorkspaceView }): ReactElement => (
            <Link
              aria-current={view.value === activeView ? "page" : undefined}
              className={
                view.value === activeView
                  ? "rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  : "rounded-lg border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/60"
              }
              href={getWorkspaceHref(view.value)}
              key={view.value}
            >
              {view.label}
            </Link>
          )
        )}
      </div>
    </nav>
  )
}

/**
 * Streams the recent-documents card independently of the folder tree.
 *
 * Kept out of the page body because this read does its own per-document access
 * lookup, so blocking the whole page on it would delay the folder listing too.
 *
 * @param props - Authenticated member and tenant identifiers.
 * @returns The populated recent-documents card, empty when the read fails.
 */
async function RecentDocumentsSection({
  actorUserId,
  organizationId,
}: {
  actorUserId: string
  organizationId: string
}): Promise<ReactElement> {
  let documents: RecentDocument[] = []

  try {
    documents = await listRecentDocuments({
      actorUserId,
      organizationId,
      limit: 6,
    })
  } catch (error: unknown) {
    console.warn("recent_documents_load_failed", {
      userId: actorUserId,
      organizationId,
      reason: getPageErrorMessage(error, "Unable to load recent documents."),
    })
  }

  return <RecentDocumentsCard documents={documents} />
}

function RecentDocumentsSkeleton(): ReactElement {
  return (
    <div
      aria-label="Loading recent documents"
      className="h-48 animate-pulse rounded-[14px] border border-border/60 bg-card"
      role="status"
    />
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
  organizationId,
  role,
  workspaceView,
}: {
  activeFolder: AccessibleDocumentFolder | null
  documents: AccessibleDocumentSummary[]
  folders: AccessibleDocumentFolder[]
  organizationId: string
  role: OrganizationContext["membership"]["role"]
  workspaceView: WorkspaceView
}): ReactElement {
  const addDocumentHref = activeFolder
    ? `/documents/new?folderId=${encodeURIComponent(activeFolder.id)}`
    : "/documents/new"
  const canCreateInLocation =
    workspaceView === "active" &&
    (!activeFolder || activeFolder.accessLevel === "contributor")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{activeFolder ? "Folder contents" : "Files and folders"}</CardTitle>
        <CardDescription>
          {workspaceView === "active"
            ? "Open a folder or document, or add a document in this location."
            : workspaceView === "archived"
              ? "Restore archived items or move them to Trash."
              : "Restore recoverable items before their retention period ends."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {folders.map((folder: AccessibleDocumentFolder) => (
            <div
              className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4"
              key={folder.id}
            >
              <Link
                className="flex min-w-0 items-center gap-3 transition-colors hover:text-primary"
                href={getFolderHref(folder.id, workspaceView)}
              >
                <Folder className="size-5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">
                  {folder.name}
                </span>
                {folder.lifecycleState === "purge_pending" ? (
                  <Badge className="ml-auto" variant="destructive">
                    Purge pending
                  </Badge>
                ) : null}
              </Link>
              {workspaceView === "trash" ? (
                <LifecycleRetentionStatus
                  lifecycleState={folder.lifecycleState}
                  purgeAfter={folder.purgeAfter}
                />
              ) : null}
              <FolderLifecycleActions
                folder={folder}
                organizationId={organizationId}
                returnFolderId={activeFolder?.id ?? null}
                role={role}
                workspaceView={workspaceView}
              />
            </div>
          ))}
          {documents.map((document: AccessibleDocumentSummary) => (
            <div
              className="flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4"
              key={document.id}
            >
              <Link
                className="flex min-w-0 items-start gap-3 transition-colors hover:text-primary"
              href={getDocumentHref(
                document.id,
                  document.sourceKind ?? "upload",
                  document.lifecycleState
              )}
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
                  {document.lifecycleState === "purge_pending"
                    ? "Purge pending"
                    : document.sourceKind === "generated" &&
                        document.lifecycleState === "active" &&
                        document.accessLevel === "contributor"
                      ? "Editable"
                      : document.sourceKind === "generated"
                        ? "Read only"
                        : "File"}
                </Badge>
              </Link>
              {workspaceView === "trash" ? (
                <LifecycleRetentionStatus
                  lifecycleState={document.lifecycleState}
                  purgeAfter={document.purgeAfter}
                />
              ) : null}
            </div>
          ))}
          {canCreateInLocation ? (
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
          ) : null}
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

function FolderLifecycleActions({
  folder,
  organizationId,
  returnFolderId,
  role,
  workspaceView,
}: {
  folder: AccessibleDocumentFolder
  organizationId: string
  returnFolderId: string | null
  role: OrganizationContext["membership"]["role"]
  workspaceView: WorkspaceView
}): ReactElement | null {
  if (
    folder.accessLevel !== "contributor" ||
    folder.lifecycleState === "purge_pending"
  ) {
    return null
  }

  return (
    <RoleGuard role={role} action="folders:manage">
      <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {folder.lifecycleState === "active" ? (
          <FolderLifecycleForm
            action={archiveFolderAction}
            folderId={folder.id}
            organizationId={organizationId}
            returnFolderId={returnFolderId}
            returnView={workspaceView}
          >
            <PermissionButton
              action="folders:manage"
              aria-label={`Archive ${folder.name}`}
              role={role}
              size="xs"
              type="submit"
              variant="outline"
            >
              <Archive data-icon="inline-start" />
              Archive
            </PermissionButton>
          </FolderLifecycleForm>
        ) : null}
        {folder.lifecycleState === "archived" ||
        folder.lifecycleState === "trashed" ? (
          <FolderLifecycleForm
            action={restoreFolderAction}
            folderId={folder.id}
            organizationId={organizationId}
            returnFolderId={returnFolderId}
            returnView={workspaceView}
          >
            <PermissionButton
              action="folders:manage"
              aria-label={`Restore ${folder.name}`}
              role={role}
              size="xs"
              type="submit"
              variant="outline"
            >
              <RotateCcw data-icon="inline-start" />
              Restore
            </PermissionButton>
          </FolderLifecycleForm>
        ) : null}
        {folder.lifecycleState === "active" ||
        folder.lifecycleState === "archived" ? (
          <FolderLifecycleForm
            action={trashFolderAction}
            folderId={folder.id}
            organizationId={organizationId}
            returnFolderId={returnFolderId}
            returnView={workspaceView}
          >
            <PermissionButton
              action="folders:manage"
              aria-label={`Move ${folder.name} to Trash`}
              role={role}
              size="xs"
              type="submit"
              variant="destructive"
            >
              <Trash2 data-icon="inline-start" />
              Trash
            </PermissionButton>
          </FolderLifecycleForm>
        ) : null}
      </div>
        {folder.lifecycleState === "trashed" ? (
          <PurgeRequestForm
            action={requestFolderPurgeAction}
            confirmationFieldName="confirmationName"
            hiddenFields={{
              organizationId,
              folderId: folder.id,
              returnFolderId: returnFolderId ?? "",
              returnView: workspaceView,
            }}
            inputId={`purge-folder-${folder.id}`}
            permissionAction="folders:manage"
            resourceKind="folder"
            resourceName={folder.name}
            role={role}
          />
        ) : null}
      </div>
    </RoleGuard>
  )
}

function FolderLifecycleForm({
  action,
  children,
  folderId,
  organizationId,
  returnFolderId,
  returnView,
}: {
  action: (formData: FormData) => Promise<void>
  children: ReactNode
  folderId: string
  organizationId: string
  returnFolderId: string | null
  returnView: WorkspaceView
}): ReactElement {
  return (
    <form action={action}>
      <input name="organizationId" type="hidden" value={organizationId} />
      <input name="folderId" type="hidden" value={folderId} />
      <input
        name="returnFolderId"
        type="hidden"
        value={returnFolderId ?? ""}
      />
      <input name="returnView" type="hidden" value={returnView} />
      {children}
    </form>
  )
}

function LifecycleRetentionStatus({
  lifecycleState,
  purgeAfter,
}: {
  lifecycleState: DocumentLifecycleState
  purgeAfter: string | null
}): ReactElement {
  return (
    <p className="text-xs text-muted-foreground">
      {getRetentionDescription(lifecycleState, purgeAfter)}
    </p>
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

function parseWorkspaceView(value: string | undefined): WorkspaceView {
  return value === "archived" || value === "trash" ? value : "active"
}

function getWorkspaceHref(view: WorkspaceView): string {
  return buildRedirect("/documents", {
    ...(view === "active" ? {} : { view }),
  })
}

function getFolderHref(
  folderId: string,
  view: WorkspaceView
): string {
  return buildRedirect(getWorkspaceHref(view), {
    folderId,
  })
}

function getDocumentHref(
  documentId: string,
  sourceKind: "upload" | "generated",
  lifecycleState: DocumentLifecycleState = "active"
): string {
  return sourceKind === "generated" && lifecycleState === "active"
    ? `/documents/${encodeURIComponent(documentId)}/edit`
    : `/documents/${encodeURIComponent(documentId)}`
}

function getWorkspaceTitle(view: WorkspaceView): string {
  if (view === "archived") {
    return "Archived"
  }

  if (view === "trash") {
    return "Trash"
  }

  return "Documents"
}

function getWorkspaceDescription(
  view: WorkspaceView,
  organizationName: string
): string {
  if (view === "archived") {
    return `Archived folders and documents for ${organizationName}.`
  }

  if (view === "trash") {
    return `Recoverable and purge-pending items for ${organizationName}.`
  }

  return `Recently opened documents and organized files for ${organizationName}.`
}

function getRetentionDescription(
  lifecycleState: DocumentLifecycleState,
  purgeAfter: string | null
): string {
  if (lifecycleState === "purge_pending") {
    return "Permanent deletion is pending."
  }

  if (purgeAfter === null) {
    return "Retention protected; no automatic purge is scheduled."
  }

  const purgeDate = new Date(purgeAfter)

  if (Number.isNaN(purgeDate.getTime())) {
    return "Automatic purge timing is unavailable."
  }

  return `Scheduled for permanent deletion ${formatMediumDateTime(purgeAfter)}.`
}
