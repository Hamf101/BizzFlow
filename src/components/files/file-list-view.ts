import { z } from "zod"

import {
  createSortSection,
  type ListOption,
  type ListOptionSection,
  type ListSortOption,
} from "@/components/data/list-option"
import { formatMediumDate } from "@/lib/date-format"
import { defineListState, formatListSort } from "@/lib/list-state"
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
  DocumentLifecycleState,
} from "@/types/document"
import type { GeneratedDocumentWorkflowStatus } from "@/types/template"

/** Files keeps the address Documents had, so every existing link still works. */
export const FILES_PATH = "/documents"

/** Longest Files search, in characters. */
export const FILE_SEARCH_MAX_LENGTH = 100

const FILE_SORT_KEYS = ["name", "modified"] as const

/** Lifecycle views besides Active, which is the view without a `view` value. */
const FILE_LIFECYCLE_VIEWS = ["archived", "trash"] as const

/** Which of the workspace's lifecycle views a Files view shows. */
export type FileLifecycleView = "active" | (typeof FILE_LIFECYCLE_VIEWS)[number]

/** Finder's four ways to look at a folder; a new person starts in Icons. */
export const FILES_LAYOUTS = ["icons", "list", "columns", "gallery"] as const

/** One way of looking at a folder. */
export type FilesLayout = (typeof FILES_LAYOUTS)[number]

/** Remembers each person's layout in their browser, as Finder does. */
export const FILES_LAYOUT_COOKIE = "bizflow_files_layout"

/**
 * Reads a remembered layout, starting new people in Icons.
 *
 * @param value - The remembered value, if any.
 * @returns A known layout.
 */
export function parseFilesLayout(value: string | undefined): FilesLayout {
  return (
    FILES_LAYOUTS.find((layout: FilesLayout): boolean => layout === value) ??
    "icons"
  )
}

/** How long a layout choice is remembered, in seconds: a year. */
export const FILES_LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Most first pages one Files layout draws; later documents draw blank. */
const MAX_FILE_PAGES = 60

/**
 * Checks that an address a form sends people back to is a Files address, so
 * a forged form cannot send them anywhere else.
 *
 * @param value - The submitted address.
 * @returns True for `/documents` with or without a query.
 */
export function isFilesReturnPath(value: string): boolean {
  return /^\/documents(?:\?[^#\s]*)?$/.test(value)
}

type FileSortKey = (typeof FILE_SORT_KEYS)[number]

/**
 * The Files page's URL state. `folderId` and `view` keep the names the
 * lifecycle actions already send people back to.
 */
export const fileListState = defineListState({
  filters: {
    folderId: z.string().uuid(),
    // The item Columns and Gallery show; it follows the person between views.
    item: z.string().uuid(),
    view: z.enum(FILE_LIFECYCLE_VIEWS),
  },
  // Folders are not paged yet: one page holds a folder's whole contents.
  pageSizes: [500],
  search: { maxLength: FILE_SEARCH_MAX_LENGTH },
  sort: {
    default: { direction: "asc", key: "name" },
    keys: FILE_SORT_KEYS,
  },
})

/** One validated Files view. */
export type FileListView = ReturnType<typeof fileListState.parse>

const DEFAULT_FILE_VIEW = fileListState.parse({})

const FILE_SORT_OPTIONS: ReadonlyArray<ListSortOption<FileSortKey>> = [
  { label: "Name, A to Z", sort: { direction: "asc", key: "name" } },
  { label: "Name, Z to A", sort: { direction: "desc", key: "name" } },
  { label: "Recently modified", sort: { direction: "desc", key: "modified" } },
  {
    label: "Least recently modified",
    sort: { direction: "asc", key: "modified" },
  },
]

const LIFECYCLE_LABELS: ReadonlyArray<readonly [FileLifecycleView, string]> = [
  ["active", "Active"],
  ["archived", "Archived"],
  ["trash", "Trash"],
]

/**
 * Reads which lifecycle view a Files view shows.
 *
 * @param view - Current Files view.
 * @returns Active, Archived, or Trash.
 */
export function getFileLifecycleView(view: FileListView): FileLifecycleView {
  return view.filters.view ?? "active"
}

/**
 * Names the workspace lifecycle a Files view reads; Trash holds both trashed
 * and purge-pending items.
 *
 * @param view - Current Files view.
 * @returns The service's lifecycle state for the view.
 */
export function getWorkspaceLifecycleState(
  view: FileListView
): "active" | "archived" | "trashed" {
  const lifecycle = getFileLifecycleView(view)

  return lifecycle === "trash" ? "trashed" : lifecycle
}

/**
 * Lists the lifecycle pills. Each opens the top of its view with the search
 * cleared, so a folder from Active never strands someone inside Trash.
 *
 * @param view - Current Files view.
 * @returns Active, Archived, and Trash, the current one marked.
 */
export function getFileLifecycleOptions(view: FileListView): ListOption[] {
  const current = getFileLifecycleView(view)

  return LIFECYCLE_LABELS.map(
    ([lifecycle, label]): ListOption => ({
      href: fileListState.href(FILES_PATH, view, {
        filters: {
          folderId: undefined,
          item: undefined,
          view: lifecycle === "active" ? undefined : lifecycle,
        },
        query: "",
      }),
      label,
      selected: current === lifecycle,
    })
  )
}

/**
 * Lists the settings kept behind the view menu: the order.
 *
 * @param view - Current Files view.
 * @returns The Sort section.
 */
export function getFileViewMenuSections(view: FileListView): ListOptionSection[] {
  return [
    createSortSection(FILE_SORT_OPTIONS, view.sort, (sort): string =>
      fileListState.href(FILES_PATH, view, { sort })
    ),
  ]
}

/**
 * Reports whether the order differs from the default, so the menu can say so.
 *
 * @param view - Current Files view.
 * @returns True when the view is not in name order.
 */
export function isFileViewAdjusted(view: FileListView): boolean {
  return formatListSort(view.sort) !== formatListSort(DEFAULT_FILE_VIEW.sort)
}

/**
 * Lists the fields a new search carries over: the folder, lifecycle view, and
 * order, but not the old query.
 *
 * @param view - Current Files view.
 * @returns Name and value pairs for hidden form fields.
 */
export function getFileSearchFields(
  view: FileListView
): Array<[name: string, value: string]> {
  return Array.from(
    fileListState.toSearchParams({ ...view, page: 1, query: "" }).entries()
  )
}

/**
 * Links to a folder in the same lifecycle view and order, with the search left
 * behind.
 *
 * @param view - Current Files view.
 * @param folderId - The folder to open, or null for the top of Files.
 * @returns The folder's Files link.
 */
export function getFolderHref(view: FileListView, folderId: string | null): string {
  return fileListState.href(FILES_PATH, view, {
    filters: { folderId: folderId ?? undefined, item: undefined },
    query: "",
  })
}

/**
 * Links to one item chosen in its folder, as Columns and Gallery show it. A
 * different folder leaves the search behind.
 *
 * @param view - Current Files view.
 * @param itemId - The folder or document to choose.
 * @param location - The folder the item sits in, or null for the top of Files.
 * @returns The chosen item's Files link.
 */
export function getItemHref(
  view: FileListView,
  itemId: string,
  location: string | null
): string {
  return fileListState.href(FILES_PATH, view, {
    filters: { folderId: location ?? undefined, item: itemId },
    query: (view.filters.folderId ?? null) === location ? view.query : "",
  })
}

/**
 * Lists the folders Columns shows, one column each, from the top of Files to
 * the open folder.
 *
 * @param path - The open folder's path, outermost first.
 * @returns Null for the top of Files, then each folder's id.
 */
export function getColumnLevels(
  path: readonly { id: string }[]
): Array<string | null> {
  return [null, ...path.map((folder: { id: string }): string => folder.id)]
}

/**
 * Names the folders a layout reads: the ones it lists, and the ones whose
 * contents it counts on a folder tile.
 *
 * @param layout - The layout being drawn.
 * @param view - Current Files view.
 * @param folders - Every folder the member may see in this lifecycle view.
 * @param path - The open folder's path, outermost first.
 * @returns The folders to read, and whether the top of Files is among them.
 */
export function getDocumentScope(
  layout: FilesLayout,
  view: FileListView,
  folders: readonly { id: string; parentFolderId: string | null }[],
  path: readonly { id: string }[]
): { folderIds: string[]; includeRoot: boolean } {
  const drawn = new Set<string | null>(
    layout === "columns"
      ? getColumnLevels(path)
      : [view.filters.folderId ?? null]
  )

  return {
    folderIds: [
      ...new Set([
        ...[...drawn].filter((level: string | null): level is string => level !== null),
        // A folder tile counts what is filed directly inside it.
        ...folders
          .filter((folder: { parentFolderId: string | null }): boolean =>
            drawn.has(folder.parentFolderId)
          )
          .map((folder: { id: string }): string => folder.id),
      ]),
    ],
    includeRoot: drawn.has(null),
  }
}

/**
 * Picks the item Columns and Gallery show: the chosen one while it sits in
 * the open folder. Otherwise Gallery starts at the folder's first document,
 * and the other layouts show no choice.
 *
 * @param view - Current Files view.
 * @param location - The open folder's folders and documents.
 * @param layout - The layout being drawn.
 * @returns The chosen item's id, or null.
 */
export function getChosenItemId(
  view: FileListView,
  location: {
    documents: readonly AccessibleDocumentSummary[]
    folders: readonly AccessibleDocumentFolder[]
  },
  layout: FilesLayout
): string | null {
  const chosen = view.filters.item
  const here = [...location.folders, ...location.documents].some(
    (item: { id: string }): boolean => item.id === chosen
  )

  if (chosen && here) {
    return chosen
  }

  return layout === "gallery"
    ? (location.documents[0]?.id ?? location.folders[0]?.id ?? null)
    : null
}

/**
 * Names the documents a layout shows a status for, and the ones whose first
 * page it draws. Only generated documents have either.
 *
 * @param layout - The layout being drawn.
 * @param view - Current Files view.
 * @param folders - Every folder the member may see in this lifecycle view.
 * @param documents - Every document the member may see in this lifecycle view.
 * @param path - The open folder's path, outermost first.
 * @returns Document ids for statuses, and the ids whose pages are drawn.
 */
export function getCardRequest(
  layout: FilesLayout,
  view: FileListView,
  folders: readonly AccessibleDocumentFolder[],
  documents: readonly AccessibleDocumentSummary[],
  path: readonly { id: string }[]
): { contentIds: string[]; documentIds: string[] } {
  const openFolder = view.filters.folderId ?? null
  const location = selectLocation(view, folders, documents)
  const generated = (list: readonly AccessibleDocumentSummary[]): string[] =>
    list
      .filter((document: AccessibleDocumentSummary): boolean => document.sourceKind === "generated")
      .map((document: AccessibleDocumentSummary): string => document.id)
  const shown =
    layout === "columns"
      ? getColumnLevels(path).flatMap(
          (level: string | null): AccessibleDocumentSummary[] =>
            selectLocation(view, folders, documents, {
              location: level,
              search: level === openFolder,
            }).documents
        )
      : location.documents
  const pagesHere = generated(location.documents)
  const chosen = getChosenItemId(view, location, layout)
  const chosenPage = chosen !== null && pagesHere.includes(chosen) ? [chosen] : []

  return {
    contentIds:
      layout === "list"
        ? []
        : layout === "columns"
          ? chosenPage
          : [...new Set([...chosenPage, ...pagesHere])].slice(0, MAX_FILE_PAGES),
    documentIds: generated(shown),
  }
}

/**
 * Links to a document; a generated document still in use opens in its editor.
 *
 * @param document - The document to open.
 * @returns The document's page or editor link.
 */
export function getDocumentHref(document: AccessibleDocumentSummary): string {
  const documentId = encodeURIComponent(document.id)

  return document.sourceKind === "generated" && document.lifecycleState === "active"
    ? `/documents/${documentId}/edit`
    : `/documents/${documentId}`
}

/**
 * Picks the current location's folders and documents, narrowed by the search
 * and put in the view's order. Folders come first, as in a file manager.
 *
 * @param view - Current Files view.
 * @param folders - Every folder the member may see in this lifecycle view.
 * @param documents - Every document the member may see in this lifecycle view.
 * @param options - Another folder to read, and whether the search narrows it;
 *   by default the open folder, searched.
 * @returns The location's folders and documents.
 */
export function selectLocation(
  view: FileListView,
  folders: readonly AccessibleDocumentFolder[],
  documents: readonly AccessibleDocumentSummary[],
  options: { location?: string | null; search?: boolean } = {}
): { documents: AccessibleDocumentSummary[]; folders: AccessibleDocumentFolder[] } {
  const location =
    options.location === undefined
      ? (view.filters.folderId ?? null)
      : options.location
  const query = options.search === false ? "" : view.query.toLocaleLowerCase()
  const matches = (name: string): boolean =>
    query === "" || name.toLocaleLowerCase().includes(query)
  const direction = view.sort.direction === "asc" ? 1 : -1
  const byName = (first: string, second: string): number =>
    first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" })
  const order = (
    first: { name: string; updatedAt: string },
    second: { name: string; updatedAt: string }
  ): number =>
    view.sort.key === "modified"
      ? (Date.parse(first.updatedAt) - Date.parse(second.updatedAt)) * direction ||
        byName(first.name, second.name)
      : byName(first.name, second.name) * direction

  return {
    documents: documents
      .filter(
        (document: AccessibleDocumentSummary): boolean =>
          document.folderId === location && matches(document.title)
      )
      .sort((first, second) =>
        order(
          { name: first.title, updatedAt: first.updatedAt },
          { name: second.title, updatedAt: second.updatedAt }
        )
      ),
    folders: folders
      .filter(
        (folder: AccessibleDocumentFolder): boolean =>
          folder.parentFolderId === location && matches(folder.name)
      )
      .sort(order),
  }
}

/**
 * Names what a document is: a filled-in document or an uploaded file.
 *
 * @param document - The document to describe.
 * @returns Document or File.
 */
export function describeDocumentKind(document: AccessibleDocumentSummary): string {
  return document.sourceKind === "generated" ? "Document" : "File"
}

/** How a Files view marks where a generated document stands. */
export type WorkflowStatusLook = { label: string; tone: "success" | "warning" }

/**
 * Names a generated document's status for its coloured dot: amber while it
 * waits on someone, green once it is done. Drafts and uploads carry none.
 *
 * @param status - The document's workflow status, if it has one.
 * @returns The dot's label and tone, or null for no dot.
 */
export function describeWorkflowStatus(
  status: GeneratedDocumentWorkflowStatus | null
): WorkflowStatusLook | null {
  if (status === "awaiting_signatures") {
    return { label: "Awaiting signatures", tone: "warning" }
  }

  return status === "completed" ? { label: "Completed", tone: "success" } : null
}

/**
 * Reads an upload's file type from its name, such as PDF or JPG.
 *
 * @param name - The file's name.
 * @returns The extension in capitals, or null when the name has none.
 */
export function getFileExtension(name: string): string | null {
  return /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toUpperCase() ?? null
}

/**
 * Says when a trashed item goes for good, in few enough words for one line on
 * a phone.
 *
 * @param lifecycleState - The item's lifecycle state.
 * @param purgeAfter - When it is scheduled for permanent deletion, if ever.
 * @returns A short note for the item's row.
 */
export function describeTrashNote(
  lifecycleState: DocumentLifecycleState,
  purgeAfter: string | null
): string {
  if (lifecycleState === "purge_pending") {
    return "Permanent deletion pending"
  }

  if (purgeAfter === null) {
    return "Won't be deleted automatically"
  }

  return Number.isNaN(new Date(purgeAfter).getTime())
    ? "Deletion date unavailable"
    : `Deletes on ${formatMediumDate(purgeAfter)}`
}
