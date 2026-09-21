import { cookies } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import {
  FILES_LAYOUT_COOKIE,
  fileListState,
  getCardRequest,
  getDocumentScope,
  getFolderHref,
  getWorkspaceLifecycleState,
  parseFilesLayout,
  type FileListView,
  type FilesLayout,
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
  listFolderDocuments,
  listWorkspaceFolders,
  type DocumentCard,
} from "@/services/document-service"
import { listSavedViews } from "@/services/saved-view-service"
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentFolder,
} from "@/types/document"

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

  const loaded = await loadFiles({
    actorUserId: user.id,
    layout,
    organizationId: context.organization.id,
    view,
  })

  if ("error" in loaded) {
    return (
      <FilesShell>
        <Alert variant="destructive">
          <AlertTitle>Files unavailable</AlertTitle>
          <AlertDescription>{loaded.error}</AlertDescription>
        </Alert>
      </FilesShell>
    )
  }

  if ("missingFolder" in loaded) {
    return (
      <FilesShell>
        <Alert variant="destructive">
          <AlertTitle>Folder unavailable</AlertTitle>
          <AlertDescription>
            This folder does not exist or is not available in the selected
            lifecycle view.
          </AlertDescription>
        </Alert>
        <Link className="text-sm font-medium underline" href={getFolderHref(view, null)}>
          Return to Files
        </Link>
      </FilesShell>
    )
  }

  const [cards, savedViews] = await Promise.all([
    loadCards(
      user.id,
      context.organization.id,
      getCardRequest(layout, view, loaded.folders, loaded.documents, loaded.path)
    ),
    listSavedViews({
      actorUserId: user.id,
      list: "documents",
      organizationId: context.organization.id,
    }).catch(() => []),
  ])

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
        activeFolder={loaded.activeFolder}
        cards={cards}
        documents={loaded.documents}
        folders={loaded.folders}
        layout={layout}
        membership={context.membership}
        organizationId={context.organization.id}
        path={loaded.path}
        savedViews={savedViews}
        view={view}
      />
    </FilesShell>
  )
}

/** One Files view: its folders, the documents it draws, and where it is. */
type LoadedFiles = {
  activeFolder: AccessibleDocumentFolder | null
  documents: AccessibleDocumentSummary[]
  folders: AccessibleDocumentFolder[]
  path: DocumentFolder[]
}

/**
 * Reads the view's folders, settles which one is open, then reads only the
 * documents that view draws.
 *
 * @param input - Actor, organization, layout, and the validated view.
 * @returns The view's contents, the folder it asked for being gone, or a
 *   user-safe reason the read failed.
 */
async function loadFiles(input: {
  actorUserId: string
  layout: FilesLayout
  organizationId: string
  view: FileListView
}): Promise<LoadedFiles | { error: string } | { missingFolder: true }> {
  const { actorUserId, layout, organizationId, view } = input
  const lifecycleState = getWorkspaceLifecycleState(view)

  try {
    const folders = await listWorkspaceFolders({
      actorUserId,
      organizationId,
      lifecycleState,
    })
    const activeFolder = view.filters.folderId
      ? (folders.find(
          (folder: AccessibleDocumentFolder): boolean =>
            folder.id === view.filters.folderId
        ) ?? null)
      : null

    if (view.filters.folderId && !activeFolder) {
      return { missingFolder: true }
    }

    const path = buildDocumentFolderPath(activeFolder, folders)

    return {
      activeFolder,
      documents: await listFolderDocuments({
        actorUserId,
        organizationId,
        lifecycleState,
        ...getDocumentScope(layout, view, folders, path),
        visibleFolderIds: folders.map(
          (folder: AccessibleDocumentFolder): string => folder.id
        ),
      }),
      folders,
      path,
    }
  } catch (error: unknown) {
    const errorMessage = getPageErrorMessage(error, "Unable to load documents.")

    console.warn("documents_workspace_load_failed", {
      organizationId,
      reason: errorMessage,
      userId: actorUserId,
    })

    return { error: errorMessage }
  }
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
