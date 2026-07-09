import { FileText, Folder } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { DocumentUploadForm } from "@/components/documents/document-upload-form"
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
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { listDocumentWorkspace } from "@/services/document-service"
import type {
  DocumentFolder,
  DocumentSummary,
  DocumentWorkspace,
} from "@/types/document"
import type { OrganizationContext } from "@/types/organization"

import { createFolderAction } from "./actions"

type DocumentsSearchParams = Promise<{
  error?: string
  message?: string
}>

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: DocumentsSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadDocumentsUser()
  const { context, errorMessage: contextErrorMessage } =
    await getCurrentOrganizationContext(user.id)
      .then((context) => ({ context, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load organization context."
        )

        console.warn("documents_context_load_failed", {
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

  const { workspace, errorMessage: workspaceErrorMessage } =
    await listDocumentWorkspace({
      actorUserId: user.id,
      organizationId: context.organization.id,
    })
      .then((workspace) => ({ workspace, errorMessage: null as string | null }))
      .catch((error: unknown) => {
        const errorMessage = getPageErrorMessage(
          error,
          "Unable to load documents."
        )

        console.warn("documents_workspace_load_failed", {
          userId: user.id,
          organizationId: context.organization.id,
          reason: errorMessage,
        })

        return {
          workspace: null,
          errorMessage,
        }
      })

  if (!workspace) {
    return (
      <DocumentsShell params={params}>
        <Alert variant="destructive">
          <AlertTitle>Documents unavailable</AlertTitle>
          <AlertDescription>{workspaceErrorMessage}</AlertDescription>
        </Alert>
      </DocumentsShell>
    )
  }

  return (
    <DocumentsShell params={params}>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">Documents</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Store folders and documents for {context.organization.name}.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <DocumentsCard documents={workspace.documents} />
          <FoldersCard folders={workspace.folders} />
        </div>
        <div className="flex flex-col gap-4">
          <RoleGuard role={context.membership.role} action="documents:create">
            <UploadCard context={context} workspace={workspace} />
          </RoleGuard>
          <RoleGuard role={context.membership.role} action="folders:manage">
            <CreateFolderCard
              folders={workspace.folders}
              organizationId={context.organization.id}
              role={context.membership.role}
            />
          </RoleGuard>
        </div>
      </div>
    </DocumentsShell>
  )
}

function DocumentsShell({
  children,
  params,
}: {
  children: ReactElement | ReactElement[]
  params: Awaited<DocumentsSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>Documents action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      {params.message && (
        <Alert>
          <AlertTitle>Documents updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}

      {children}
    </div>
  )
}

function DocumentsCard({
  documents,
}: {
  documents: DocumentSummary[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active documents</CardTitle>
        <CardDescription>Current organization files.</CardDescription>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <Alert>
            <AlertTitle>No documents yet</AlertTitle>
            <AlertDescription>Use the upload panel to add the first file.</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            {documents.map((document: DocumentSummary) => (
              <Link
                className="grid gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_140px]"
                href={`/documents/${document.id}`}
                key={document.id}
              >
                <div className="flex min-w-0 gap-3">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium">
                      {document.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Created {formatDate(document.createdAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-start justify-start md:justify-end">
                  <Badge variant={document.currentVersionId ? "secondary" : "outline"}>
                    {document.currentVersionId ? "Available" : "Pending upload"}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FoldersCard({
  folders,
}: {
  folders: DocumentFolder[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Folders</CardTitle>
        <CardDescription>Active document groups.</CardDescription>
      </CardHeader>
      <CardContent>
        {folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No folders yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {folders.map((folder: DocumentFolder) => (
              <div
                className="flex items-center gap-2 rounded-lg border bg-background p-3"
                key={folder.id}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{folder.name}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function UploadCard({
  context,
  workspace,
}: {
  context: OrganizationContext
  workspace: DocumentWorkspace
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload document</CardTitle>
        <CardDescription>Add a file to the workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <DocumentUploadForm
          folders={workspace.folders}
          organizationId={context.organization.id}
        />
      </CardContent>
    </Card>
  )
}

function CreateFolderCard({
  folders,
  organizationId,
  role,
}: {
  folders: DocumentFolder[]
  organizationId: string
  role: OrganizationContext["membership"]["role"]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create folder</CardTitle>
        <CardDescription>Add a document group.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createFolderAction} className="flex flex-col gap-5">
          <input type="hidden" name="organizationId" value={organizationId} />
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
            <Field>
              <FieldLabel htmlFor="parent-folder">Parent folder</FieldLabel>
              <select
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                id="parent-folder"
                name="parentFolderId"
              >
                <option value="">None</option>
                {folders.map((folder: DocumentFolder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
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

async function loadDocumentsUser(): Promise<AuthenticatedUser> {
  try {
    return await getAuthenticatedUser()
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      redirect(buildRedirect("/login", { next: "/documents" }))
    }

    throw error
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value))
}

function getPageErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message
  }

  return fallback
}
