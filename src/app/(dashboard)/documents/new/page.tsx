import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { AddDocument } from "@/components/documents/add-document"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { buildDocumentFolderPath } from "@/lib/page-document-folders"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { listDocumentWorkspace } from "@/services/document-service"
import { listDocumentTemplates } from "@/services/template-service"
import type { DocumentFolder } from "@/types/document"
import type { DocumentTemplate } from "@/types/template"

import { createGeneratedDocumentAction } from "../actions"

type NewDocumentSearchParams = Promise<{
  folderId?: string
}>

/**
 * Lets a member upload a file or create a document in one folder.
 *
 * @param props - The target folder.
 * @returns The centered choice between uploading and creating.
 */
export default async function NewDocumentPage({
  searchParams
}: {
  searchParams: NewDocumentSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/documents/new")
  const { context } = await loadPageOrganizationContext({
    userId: user.id,
    failureEvent: "new_document_page_context_failed"
  })

  if (!context) {
    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
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
          Return to Files
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

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center md:min-h-[calc(100dvh-4.5rem)] gap-8 text-center">
      <div className="flex flex-col items-center gap-2">
        {folderPath.length > 0 ? (
          <nav aria-label="New document folder path">
            <ol className="flex flex-wrap items-center justify-center gap-1 text-sm text-muted-foreground">
              <li>
                <Link href="/documents">Files</Link>
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
            </ol>
          </nav>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-normal">Add document</h1>
      </div>
      <AddDocument
        createAction={createGeneratedDocumentAction}
        folderId={activeFolder?.id ?? null}
        organizationId={context.organization.id}
        templates={publishedTemplates.map((template: DocumentTemplate) => ({
          id: template.id,
          title: template.title,
        }))}
      />
    </div>
  )
}
