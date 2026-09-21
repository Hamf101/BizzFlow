import { ChevronRight } from "lucide-react"
import Link from "next/link"
import type { ReactElement, ReactNode } from "react"

import { ListFilterChips } from "@/components/data/list-filter-chips"
import { ListSearch } from "@/components/data/list-search"
import { type ListSavedViews, ListViewMenu, ListViewTitle } from "@/components/data/list-view-menu"
import { PurgeRequestForm } from "@/components/documents/purge-request-form"
import type { FileEntry } from "@/components/files/file-entry"
import {
  FileColumnsLayout,
  FileGalleryLayout,
  FileIconsLayout,
  FileListLayout,
  type FileColumn,
} from "@/components/files/file-layouts"
import {
  describeDocumentKind,
  describeTrashNote,
  describeWorkflowStatus,
  FILE_SEARCH_MAX_LENGTH,
  fileListState,
  FILES_PATH,
  getChosenItemId,
  getColumnLevels,
  getDocumentHref,
  getFileExtension,
  getFileLifecycleOptions,
  getFileLifecycleView,
  getFileSearchFields,
  getFileViewMenuSections,
  getFolderHref,
  getItemHref,
  isFileViewAdjusted,
  selectLocation,
  type FileLifecycleView,
  type FileListView,
  type FilesLayout,
} from "@/components/files/file-list-view"
import {
  FileRowMenu,
  type FileLifecycleAction,
} from "@/components/files/file-row-menu"
import {
  FileSelection,
  type SelectableFile,
} from "@/components/files/file-selection"
import { FilesLayoutSwitch } from "@/components/files/files-layout-switch"
import type { MoveDestination } from "@/components/files/move-to-dialog"
import { NewFileMenu, type NewFolderForm } from "@/components/files/new-file-menu"
import { SelectionBar } from "@/components/files/selection-bar"
import { formatMediumDate } from "@/lib/date-format"
import {
  canPerformOrganizationAction,
  type OrganizationPermissionSubject,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type { DocumentCard } from "@/services/document-service"
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentFolder,
  DocumentLifecycleState,
} from "@/types/document"

type FormAction = (formData: FormData) => Promise<void>

/** The server actions a Files page hands its items, New menu, and layout switch. */
export type FilesWorkspaceActions = {
  archiveDocument: FormAction
  archiveFolder: FormAction
  createFolder: FormAction
  requestDocumentPurge: FormAction
  requestFolderPurge: FormAction
  restoreDocument: FormAction
  restoreFolder: FormAction
  setLayout: FormAction
  trashDocument: FormAction
  trashFolder: FormAction
}

type LifecycleForms = { archive: FormAction; restore: FormAction; trash: FormAction }

type Location = {
  documents: AccessibleDocumentSummary[]
  folders: AccessibleDocumentFolder[]
}

/** What each lifecycle state lets a manager do, in menu order. */
const LIFECYCLE_LABELS: Record<DocumentLifecycleState, FileLifecycleAction["label"][]> = {
  active: ["Archive", "Move to Trash"],
  archived: ["Restore", "Move to Trash"],
  purge_pending: [],
  trashed: ["Restore"],
}

/**
 * Renders Files: a quiet front with search, order, and New, lifecycle pills
 * beside Finder's four-way layout switch, the folder path, and the open folder
 * in the chosen layout — Icons, List, Columns, or Gallery. Each item's
 * lifecycle actions sit behind its menu, offered only where the member may
 * manage that item; in List and Icons, a selection of items shares them.
 *
 * @param props - The view and layout, the lifecycle view's folders and
 *   documents with their cards, the open folder and its path, the member's
 *   permissions, and the server actions.
 * @returns The Files workspace.
 */
export function FilesWorkspace({
  actions,
  activeFolder,
  cards,
  documents,
  folders,
  layout,
  membership,
  organizationId,
  path,
  savedViews,
  view,
}: {
  actions: FilesWorkspaceActions
  activeFolder: AccessibleDocumentFolder | null
  cards: ReadonlyMap<string, DocumentCard>
  documents: AccessibleDocumentSummary[]
  folders: AccessibleDocumentFolder[]
  layout: FilesLayout
  membership: OrganizationPermissionSubject
  organizationId: string
  path: DocumentFolder[]
  savedViews: ListSavedViews["saved"]
  view: FileListView
}): ReactElement {
  const lifecycle = getFileLifecycleView(view)
  const openFolder = view.filters.folderId ?? null
  const location = selectLocation(view, folders, documents)
  const total = location.folders.length + location.documents.length
  const counts = countItems(folders, documents)
  const returnFields = {
    organizationId,
    returnFolderId: activeFolder?.id ?? "",
    returnView: lifecycle,
  }
  // New things go only where the member may contribute, among active files.
  const canContribute =
    lifecycle === "active" &&
    (activeFolder === null || activeFolder.accessLevel === "contributor")
  const addDocumentHref =
    canContribute && canPerformOrganizationAction(membership, "documents:create")
      ? activeFolder
        ? `/documents/new?folderId=${encodeURIComponent(activeFolder.id)}`
        : "/documents/new"
      : null
  const newFolder: NewFolderForm | null =
    canContribute && canPerformOrganizationAction(membership, "folders:manage")
      ? {
          action: actions.createFolder,
          fields: {
            organizationId,
            parentFolderId: activeFolder?.id ?? "",
            returnFolderId: activeFolder?.id ?? "",
          },
          label: activeFolder ? "New subfolder" : "New folder",
        }
      : null
  const offersNew = addDocumentHref !== null || newFolder !== null
  const canManageFolders = canPerformOrganizationAction(membership, "folders:manage")
  const canManageDocuments = canPerformOrganizationAction(
    membership,
    "documents:archive"
  )
  const folderPath = ["Files", ...path.map((folder: DocumentFolder) => folder.name)].join(
    " › "
  )
  // Items move only among active folders the member may add to.
  const destinations: MoveDestination[] =
    lifecycle === "active"
      ? folders
          .filter(
            (folder: AccessibleDocumentFolder): boolean =>
              folder.accessLevel === "contributor" && folder.lifecycleState === "active"
          )
          .map((folder: AccessibleDocumentFolder): MoveDestination => ({
            id: folder.id,
            name: folder.name,
            parentFolderId: folder.parentFolderId,
          }))
      : []

  function folderMenu(folder: AccessibleDocumentFolder): ReactNode {
    if (!canManageFolders || !isManageable(folder)) {
      return null
    }

    const fields = { ...returnFields, folderId: folder.id }

    return (
      <FileRowMenu
        actions={lifecycleActions(
          folder.lifecycleState,
          {
            archive: actions.archiveFolder,
            restore: actions.restoreFolder,
            trash: actions.trashFolder,
          },
          fields
        )}
        itemId={folder.id}
        name={folder.name}
        purgeForm={
          folder.lifecycleState === "trashed" ? (
            <PurgeRequestForm
              action={actions.requestFolderPurge}
              confirmationFieldName="confirmationName"
              hiddenFields={fields}
              inDialog
              inputId={`purge-folder-${folder.id}`}
              permissionAction="folders:manage"
              resourceKind="folder"
              resourceName={folder.name}
              role={membership}
            />
          ) : undefined
        }
      />
    )
  }

  function documentMenu(document: AccessibleDocumentSummary): ReactNode {
    if (!canManageDocuments || !isManageable(document)) {
      return null
    }

    const fields = { ...returnFields, documentId: document.id }

    return (
      <FileRowMenu
        actions={lifecycleActions(
          document.lifecycleState,
          {
            archive: actions.archiveDocument,
            restore: actions.restoreDocument,
            trash: actions.trashDocument,
          },
          fields
        )}
        itemId={document.id}
        name={document.title}
        purgeForm={
          document.lifecycleState === "trashed" ? (
            <PurgeRequestForm
              action={actions.requestDocumentPurge}
              confirmationFieldName="confirmationTitle"
              hiddenFields={fields}
              inDialog
              inputId={`purge-document-${document.id}`}
              permissionAction="documents:archive"
              resourceKind="document"
              resourceName={document.title}
              role={membership}
            />
          ) : undefined
        }
      />
    )
  }

  // Folders open when chosen in Columns, as in Finder; Gallery shows them.
  function toEntries(
    at: Location,
    where: string | null,
    folderChoice: "choose" | "open"
  ): FileEntry[] {
    return [
      ...at.folders.map(
        (folder: AccessibleDocumentFolder): FileEntry => ({
          content: null,
          count: counts.get(folder.id) ?? 0,
          extension: null,
          href: getFolderHref(view, folder.id),
          id: folder.id,
          kind: "folder",
          menu: folderMenu(folder),
          modified: formatMediumDate(folder.updatedAt),
          name: folder.name,
          note:
            lifecycle === "trash"
              ? describeTrashNote(folder.lifecycleState, folder.purgeAfter)
              : null,
          selectHref:
            folderChoice === "open"
              ? getFolderHref(view, folder.id)
              : getItemHref(view, folder.id, where),
          status: null,
          type: "Folder",
        })
      ),
      ...at.documents.map((document: AccessibleDocumentSummary): FileEntry => {
        const card = cards.get(document.id)
        const generated = document.sourceKind === "generated"

        return {
          content: card?.content ?? null,
          count: null,
          extension: generated ? null : getFileExtension(document.title),
          href: getDocumentHref(document),
          id: document.id,
          kind: generated ? "document" : "upload",
          menu: documentMenu(document),
          modified: formatMediumDate(document.updatedAt),
          name: document.title,
          note:
            lifecycle === "trash"
              ? describeTrashNote(document.lifecycleState, document.purgeAfter)
              : null,
          selectHref: getItemHref(view, document.id, where),
          status: describeWorkflowStatus(card?.workflowStatus ?? null),
          type: describeDocumentKind(document),
        }
      }),
    ]
  }

  const entries = toEntries(location, openFolder, layout === "gallery" ? "choose" : "open")
  // What everything in the folder allows, so a selection narrowed by a search
  // still offers only what all of its items allow — including the ones the
  // search is hiding.
  const inFolder = selectLocation(view, folders, documents, { search: false })
  const selectable: SelectableFile[] = [
    ...inFolder.folders.map(
      (folder: AccessibleDocumentFolder): SelectableFile => ({
        id: folder.id,
        kind: "folder",
        labels:
          canManageFolders && isManageable(folder)
            ? LIFECYCLE_LABELS[folder.lifecycleState]
            : [],
      })
    ),
    ...inFolder.documents.map(
      (document: AccessibleDocumentSummary): SelectableFile => ({
        id: document.id,
        kind: "document",
        labels:
          canManageDocuments && isManageable(document)
            ? LIFECYCLE_LABELS[document.lifecycleState]
            : [],
      })
    ),
  ]
  const chosenId = getChosenItemId(view, location, layout)
  const chosen = entries.find((entry: FileEntry): boolean => entry.id === chosenId) ?? null
  const empty = (
    // Outside any table: an empty folder is a message, not a row.
    <p className="py-16 text-center text-sm text-muted-foreground" role="status">
      {describeEmptyLocation(view, lifecycle, activeFolder)}
    </p>
  )
  // Columns and Gallery need width; phones show Icons instead.
  const icons = (
    <FileIconsLayout className="md:hidden" entries={entries} selected={chosenId} />
  )

  function renderLayout(): ReactNode {
    if (layout === "columns") {
      const levels = getColumnLevels(path)
      const columns = levels.map(
        (level: string | null, index: number): FileColumn => ({
          entries: toEntries(
            selectLocation(view, folders, documents, {
              location: level,
              search: level === openFolder,
            }),
            level,
            "open"
          ),
          label: index === 0 ? "Files" : (path[index - 1]?.name ?? "Folder"),
          location: level,
          selected: levels[index + 1] ?? (level === openFolder ? chosenId : null),
        })
      )

      return (
        <>
          <div className="hidden md:block">
            <FileColumnsLayout chosen={chosen} columns={columns} folder={folderPath} />
          </div>
          <div className="md:hidden">{total === 0 ? empty : icons}</div>
        </>
      )
    }

    if (total === 0) {
      return empty
    }

    if (layout === "list") {
      return <FileListLayout entries={entries} selected={chosenId} />
    }

    if (layout === "gallery" && chosen) {
      return (
        <>
          <div className="hidden md:block">
            <FileGalleryLayout chosen={chosen} entries={entries} folder={folderPath} />
          </div>
          {icons}
        </>
      )
    }

    return <FileIconsLayout entries={entries} selected={chosenId} />
  }

  const listViews: ListSavedViews = {
    list: "documents",
    // The item Columns or Gallery has chosen is not part of a view.
    query: fileListState
      .toSearchParams({
        ...view,
        filters: { ...view.filters, item: undefined },
        page: 1,
      })
      .toString(),
    saved: savedViews,
  }

  return (
    <FileSelection
      destinations={destinations}
      folderId={openFolder}
      items={selectable}
      // Another folder or lifecycle view starts a fresh selection; a search,
      // a different order, or a later page narrows the same one.
      key={`${openFolder ?? ""}:${lifecycle}`}
      lifecycle={lifecycle}
      shown={entries.map((entry: FileEntry): string => entry.id)}
    >
      <section className="flex flex-col gap-5" data-slot="files-workspace">
        {/* The real space keeps the accessible name "Files 12 items" rather
            than "Files12 items". */}
        <h1 className="text-2xl leading-none font-medium tracking-[-0.02em]">
          <ListViewTitle title="Files" views={listViews} />{" "}
          <span
            aria-label={`${total} ${total === 1 ? "item" : "items"}`}
            className="ml-0.5 text-xl font-normal text-muted-foreground"
          >
            {total}
          </span>
        </h1>

        <div
          className={cn(
            "grid gap-2",
            offersNew
              ? "grid-cols-[minmax(0,1fr)_auto_auto]"
              : "grid-cols-[minmax(0,1fr)_auto]"
          )}
        >
          <ListSearch
            fields={getFileSearchFields(view)}
            label="Search files"
            maxLength={FILE_SEARCH_MAX_LENGTH}
            path={FILES_PATH}
            placeholder="Search files…"
            query={view.query}
          />
          <ListViewMenu
            adjusted={isFileViewAdjusted(view)}
            label="View options"
            sections={getFileViewMenuSections(view)}
            views={listViews}
          />
          {offersNew ? (
            <NewFileMenu addDocumentHref={addDocumentHref} newFolder={newFolder} />
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <ListFilterChips
            glide
            label="Show files by state"
            options={getFileLifecycleOptions(view)}
          />
          <FilesLayoutSwitch
            action={actions.setLayout}
            current={layout}
            returnTo={fileListState.href(FILES_PATH, view)}
          />
        </div>

        {path.length > 0 ? (
          // Columns draws the path itself where it has room.
          <FolderPath
            className={layout === "columns" ? "md:hidden" : undefined}
            path={path}
            view={view}
          />
        ) : null}

        {renderLayout()}
      </section>
      <SelectionBar />
    </FileSelection>
  )
}

function FolderPath({
  className,
  path,
  view,
}: {
  className?: string
  path: DocumentFolder[]
  view: FileListView
}): ReactElement {
  const linkClassName =
    "truncate rounded-[6px] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35"

  return (
    <nav aria-label="Folder path" className={cn("-mt-1", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <Link className={linkClassName} href={getFolderHref(view, null)}>
            Files
          </Link>
        </li>
        {path.map((folder: DocumentFolder, index: number) => (
          <li className="flex min-w-0 items-center gap-1" key={folder.id}>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
            {index === path.length - 1 ? (
              <span aria-current="page" className="truncate font-medium text-foreground">
                {folder.name}
              </span>
            ) : (
              <Link className={linkClassName} href={getFolderHref(view, folder.id)}>
                {folder.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** Counts each folder's direct contents in this lifecycle view. */
function countItems(
  folders: readonly AccessibleDocumentFolder[],
  documents: readonly AccessibleDocumentSummary[]
): Map<string, number> {
  const counts = new Map<string, number>()
  const parents = [
    ...folders.map((folder: AccessibleDocumentFolder) => folder.parentFolderId),
    ...documents.map((document: AccessibleDocumentSummary) => document.folderId),
  ]

  for (const parent of parents) {
    if (parent) {
      counts.set(parent, (counts.get(parent) ?? 0) + 1)
    }
  }

  return counts
}

// A queued purge is already irreversible, and only contributors may change an
// item, so neither gets a menu.
function isManageable(item: {
  accessLevel: string
  lifecycleState: DocumentLifecycleState
}): boolean {
  return item.accessLevel === "contributor" && item.lifecycleState !== "purge_pending"
}

function lifecycleActions(
  lifecycleState: DocumentLifecycleState,
  forms: LifecycleForms,
  fields: Readonly<Record<string, string>>
): FileLifecycleAction[] {
  const formFor: Record<FileLifecycleAction["label"], FormAction> = {
    Archive: forms.archive,
    "Move to Trash": forms.trash,
    Restore: forms.restore,
  }

  return LIFECYCLE_LABELS[lifecycleState].map(
    (label: FileLifecycleAction["label"]): FileLifecycleAction => ({
      fields,
      formAction: formFor[label],
      label,
    })
  )
}

function describeEmptyLocation(
  view: FileListView,
  lifecycle: FileLifecycleView,
  activeFolder: AccessibleDocumentFolder | null
): string {
  if (view.query) {
    return "No files match this search."
  }

  if (lifecycle === "trash") {
    return "Trash is empty."
  }

  if (lifecycle === "archived") {
    return "Nothing is archived here."
  }

  return activeFolder ? "This folder is empty." : "No files yet."
}
