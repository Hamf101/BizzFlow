import { cookies } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import {
  FILES_LAYOUT_COOKIE,
  fileListState,
  getCardRequest,
  getFolderHref,
  getWorkspaceLifecycleState,
  parseFilesLayout,
} from "@/components/files/file-list-view"
import { FilesWorkspace } from "@/components/files/files-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import type { RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { buildDocumentFolderPath } from "@/lib/page-document-folders"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import {
  listDocumentCards,
  listDocumentWorkspace,
  type DocumentCard,
} from "@/services/document-service"
import type { AccessibleDocumentFolder, DocumentWorkspace } from "@/types/document"

import {
  archiveDocumentAction,
  archiveFolderAction,
  createFolderAction,
  requestDocumentPurgeAction,
  requestFolderPurgeAction,
  restoreDocumentAction,
  restoreFolderAction,
  setFilesLayoutAction,
  trashDocumentAction,
  trashFolderAction,
} from "./actions"

/**
 * Lists the current folder of Files — the member's documents and uploads —
 * in one lifecycle view and the person's remembered layout, searched and
 * ordered by the validated URL.
 *
 * @param props - View state in search parameters.
 * @returns The Files workspace, or a user-safe access or load failure.
 */
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}): Promise<ReactElement> {
  const view = fileListState.parse(await searchParams)
  const layout = parseFilesLayout((await cookies()).get(FILES_LAYOUT_COOKIE)?.value)
  const user = await loadAuthenticatedPageUser("/documents")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "documents_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <FilesShell>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </FilesShell>
      )
    }

    redirect(buildFeedbackRedirect("/dashboard", "organization_required"))
  }

  let workspace: DocumentWorkspace

  try {
    workspace = await listDocumentWorkspace({
      actorUserId: user.id,
      organizationId: context.organization.id,
      lifecycleState: getWorkspaceLifecycleState(view),
    })
  } catch (error: unknown) {
    const errorMessage = getPageErrorMessage(error, "Unable to load documents.")

    console.warn("documents_workspace_load_failed", {
      organizationId: context.organization.id,
      reason: errorMessage,
      userId: user.id,
    })

    return (
      <FilesShell>
        <Alert variant="destructive">
          <AlertTitle>Files unavailable</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      </FilesShell>
    )
  }

  const activeFolder = view.filters.folderId
    ? (workspace.folders.find(
        (folder: AccessibleDocumentFolder): boolean =>
          folder.id === view.filters.folderId
      ) ?? null)
    : null

  if (view.filters.folderId && !activeFolder) {
    return (
      <FilesShell>
        <Alert variant="destructive">
          <AlertTitle>Folder unavailable</AlertTitle>
          <AlertDescription>
            This folder does not exist or is not available in the selected
            lifecycle view.
          </AlertDescription>
        </Alert>
        <Link
          className="text-sm font-medium underline"
          href={getFolderHref(view, null)}
        >
          Return to Files
        </Link>
      </FilesShell>
    )
  }

  const path = buildDocumentFolderPath(activeFolder, workspace.folders)
  const cards = await loadCards(
    user.id,
    context.organization.id,
    getCardRequest(layout, view, workspace.folders, workspace.documents, path)
  )

  return (
    <FilesShell>
      <FilesWorkspace
        actions={{
          archiveDocument: archiveDocumentAction,
          archiveFolder: archiveFolderAction,
          createFolder: createFolderAction,
          requestDocumentPurge: requestDocumentPurgeAction,
          requestFolderPurge: requestFolderPurgeAction,
          restoreDocument: restoreDocumentAction,
          restoreFolder: restoreFolderAction,
          setLayout: setFilesLayoutAction,
          trashDocument: trashDocumentAction,
          trashFolder: trashFolderAction,
        }}
        activeFolder={activeFolder}
        cards={cards}
        documents={workspace.documents}
        folders={workspace.folders}
        layout={layout}
        membership={context.membership}
        organizationId={context.organization.id}
        path={path}
        view={view}
      />
    </FilesShell>
  )
}

// Statuses and pages only decorate the folder, so a failed read leaves the
// files listed without them.
async function loadCards(
  actorUserId: string,
  organizationId: string,
  request: { contentIds: string[]; documentIds: string[] }
): Promise<Map<string, DocumentCard>> {
  if (request.documentIds.length === 0 && request.contentIds.length === 0) {
    return new Map()
  }

  try {
    const cards = await listDocumentCards({ actorUserId, organizationId, ...request })

    return new Map(cards.map((card: DocumentCard) => [card.id, card]))
  } catch (error: unknown) {
    console.warn("files_cards_unavailable", {
      organizationId,
      reason: getPageErrorMessage(error, "Unable to load document statuses."),
    })
    return new Map()
  }
}

function FilesShell({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex flex-col gap-6">{children}</div>
}
