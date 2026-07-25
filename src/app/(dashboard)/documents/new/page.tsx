import { ChevronRight, FilePlus2, LayoutTemplate, Upload } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { DocumentUploadForm } from "@/components/documents/document-upload-form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getAuthenticatedUser } from "@/lib/auth"
import { buildRedirect } from "@/lib/form-utils"
import { buildDocumentFolderPath } from "@/lib/page-document-folders"
import { listDocumentWorkspace } from "@/services/document-service"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import { listDocumentTemplates } from "@/services/template-service"
import type { DocumentFolder } from "@/types/document"
import type { DocumentTemplate } from "@/types/template"

import { createGeneratedDocumentAction } from "../actions"

type NewDocumentSearchParams = Promise<{
  error?: string
  folderId?: string
  mode?: string
}>

/**
 * Lets a member upload a file or create a structured document in one folder.
 *
 * @param props - Creation mode, target folder, and optional action error.
 * @returns Two-step document creation page.
 */
export default async function NewDocumentPage({
  searchParams
}: {
  searchParams: NewDocumentSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await getAuthenticatedUser()
  const context = await getCurrentOrganizationContext(user.id)

  if (!context) {
    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before adding documents."
      })
    )
  }

  const [workspace, templates] = await Promise.all([
    listDocumentWorkspace({
      actorUserId: user.id,
      organizationId: context.organization.id
    }),
    listDocumentTemplates({
      actorUserId: user.id,
      organizationId: context.organization.id
    })
  ])
  const activeFolder = params.folderId
    ? (workspace.folders.find(
        (folder: DocumentFolder): boolean => folder.id === params.folderId
      ) ?? null)
    : null

  if (params.folderId && !activeFolder) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Folder unavailable</AlertTitle>
          <AlertDescription>
            Choose an active folder before adding a document.
          </AlertDescription>
        </Alert>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href="/documents"
        >
          Return to Documents
        </Link>
      </div>
    )
  }

  const publishedTemplates = templates.filter(
    (template: DocumentTemplate): boolean =>
      template.status === "published" &&
      !template.content.blocks.some(
        (block): boolean => block.type === "file_field"
      )
  )
  const folderPath = buildDocumentFolderPath(activeFolder, workspace.folders)
  const locationHref = activeFolder
    ? `/documents?folderId=${encodeURIComponent(activeFolder.id)}`
    : "/documents"
  const folderQuery = activeFolder
    ? `&folderId=${encodeURIComponent(activeFolder.id)}`
    : ""

  return (
    <div className="flex flex-col gap-6">
      {params.error ? (
        <Alert variant="destructive">
          <AlertTitle>Document creation failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <nav aria-label="New document folder path">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <li>
              <Link href="/documents">Documents</Link>
            </li>
            {folderPath.map((folder: DocumentFolder) => (
              <li className="flex items-center gap-1" key={folder.id}>
                <ChevronRight aria-hidden="true" className="size-4" />
                <Link
                  href={`/documents?folderId=${encodeURIComponent(folder.id)}`}
                >
                  {folder.name}
                </Link>
              </li>
            ))}
            <li className="flex items-center gap-1 text-foreground">
              <ChevronRight aria-hidden="true" className="size-4" />
              Add document
            </li>
          </ol>
        </nav>
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            Add document
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload an existing file or create an editable guided document.
          </p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          className={`rounded-xl border p-5 transition-colors hover:bg-muted/50 ${
            params.mode === "upload" ? "border-foreground bg-muted/40" : ""
          }`}
          href={`/documents/new?mode=upload${folderQuery}`}
        >
          <Upload className="mb-3 size-6" />
          <h2 className="font-semibold">Upload a document</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep an existing PDF, image, Word file, spreadsheet, or CSV as a
            file.
          </p>
        </Link>
        <Link
          className={`rounded-xl border p-5 transition-colors hover:bg-muted/50 ${
            params.mode === "create" ? "border-foreground bg-muted/40" : ""
          }`}
          href={`/documents/new?mode=create${folderQuery}`}
        >
          <FilePlus2 className="mb-3 size-6" />
          <h2 className="font-semibold">Create a document</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Start empty or use a published organization template.
          </p>
        </Link>
      </div>

      {params.mode === "upload" ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload document</CardTitle>
            <CardDescription>
              The file will be added to {activeFolder?.name ?? "Documents"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentUploadForm
              folders={workspace.folders}
              initialFolderId={activeFolder?.id ?? null}
              lockFolderSelection
              organizationId={context.organization.id}
            />
          </CardContent>
        </Card>
      ) : null}

      {params.mode === "create" ? (
        <Card>
          <CardHeader>
            <CardTitle>Create editable document</CardTitle>
            <CardDescription>
              Choose the current organization template revision or start with an
              empty free-form page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={createGeneratedDocumentAction}
              className="flex flex-col gap-5"
            >
              <input
                name="folderId"
                type="hidden"
                value={activeFolder?.id ?? ""}
              />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="generated-document-title">
                    Title
                  </FieldLabel>
                  <Input
                    id="generated-document-title"
                    maxLength={180}
                    minLength={1}
                    name="title"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="generated-document-description">
                    Description
                  </FieldLabel>
                  <Input
                    id="generated-document-description"
                    maxLength={2_000}
                    name="description"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="generated-document-template">
                    Starting point
                  </FieldLabel>
                  <select
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    defaultValue=""
                    id="generated-document-template"
                    name="templateId"
                  >
                    <option value="">Empty free-form document</option>
                    {publishedTemplates.map((template: DocumentTemplate) => (
                      <option key={template.id} value={template.id}>
                        {template.title} (revision {template.revision})
                      </option>
                    ))}
                  </select>
                  <FieldDescription>
                    This document keeps an immutable snapshot of the selected
                    revision. Templates with file upload fields are used from
                    Submissions.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Button type="submit">
                <LayoutTemplate data-icon="inline-start" />
                Create and edit
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Link
        className={buttonVariants({
          className: "self-start",
          variant: "ghost"
        })}
        href={locationHref}
      >
        Back to {activeFolder?.name ?? "Documents"}
      </Link>
    </div>
  )
}
