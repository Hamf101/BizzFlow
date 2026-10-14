// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import {
  fileListState,
  type FilesLayout,
} from "@/components/files/file-list-view"
import {
  FilesWorkspace,
  type FilesWorkspaceActions,
} from "@/components/files/files-workspace"
import type { OrganizationPermissionSubject } from "@/lib/permissions"
import type { DocumentCard } from "@/services/document-service"
import type {
  AccessibleDocumentFolder,
  AccessibleDocumentSummary,
} from "@/types/document"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const CONTRACTS_ID = "40000000-0000-4000-8000-000000000001"
const LEASES_ID = "40000000-0000-4000-8000-000000000002"
const SIGNED_ID = "40000000-0000-4000-8000-000000000003"
const WELCOME_ID = "60000000-0000-4000-8000-000000000001"
const ZONING_ID = "60000000-0000-4000-8000-000000000002"
const MSA_ID = "60000000-0000-4000-8000-000000000003"
const NDA_ID = "60000000-0000-4000-8000-000000000004"

async function formAction(): Promise<void> {}

const actions: FilesWorkspaceActions = {
  archiveDocument: formAction,
  archiveFolder: formAction,
  createFolder: formAction,
  requestDocumentPurge: formAction,
  requestFolderPurge: formAction,
  restoreDocument: formAction,
  restoreFolder: formAction,
  setLayout: formAction,
  trashDocument: formAction,
  trashFolder: formAction,
}

const lifecycleFields = {
  accessLevel: "contributor",
  archivedAt: null,
  archivedBy: null,
  createdAt: "2026-09-01T09:00:00.000Z",
  createdBy: null,
  lifecycleState: "active",
  organizationId: ORG_ID,
  preTrashLifecycleState: null,
  purgeAfter: null,
  trashOperationId: null,
  trashedAt: null,
  trashedBy: null,
  updatedAt: "2026-09-02T09:00:00.000Z",
  updatedBy: null,
} as const

function createFolder(
  overrides: Partial<AccessibleDocumentFolder> &
    Pick<AccessibleDocumentFolder, "id" | "name">
): AccessibleDocumentFolder {
  return { ...lifecycleFields, parentFolderId: null, ...overrides }
}

function createDocument(
  overrides: Partial<AccessibleDocumentSummary> &
    Pick<AccessibleDocumentSummary, "id" | "title">
): AccessibleDocumentSummary {
  return {
    ...lifecycleFields,
    currentVersionId: null,
    description: null,
    folderId: null,
    sourceKind: "upload",
    ...overrides,
  }
}

const leases = createFolder({ id: LEASES_ID, name: "Leases" })
const contracts = createFolder({ id: CONTRACTS_ID, name: "Contracts" })
const zoning = createDocument({ id: ZONING_ID, title: "Zoning letter" })
const welcome = createDocument({
  id: WELCOME_ID,
  sourceKind: "generated",
  title: "Welcome pack",
})

const folders = [
  leases,
  contracts,
  createFolder({ id: SIGNED_ID, name: "Signed", parentFolderId: CONTRACTS_ID }),
]

const documents = [
  zoning,
  welcome,
  createDocument({
    folderId: CONTRACTS_ID,
    id: MSA_ID,
    title: "Master services agreement",
    updatedAt: "2026-09-03T09:00:00.000Z",
  }),
  createDocument({
    folderId: CONTRACTS_ID,
    id: NDA_ID,
    title: "Mutual NDA",
    updatedAt: "2026-09-10T09:00:00.000Z",
  }),
]

afterEach(() => {
  document.body.replaceChildren()
})

function renderWorkspace({
  cards = [],
  documents: shownDocuments = documents,
  folders: shownFolders = folders,
  layout = "list",
  membership = "owner_admin",
  params = {},
}: {
  cards?: DocumentCard[]
  documents?: AccessibleDocumentSummary[]
  folders?: AccessibleDocumentFolder[]
  layout?: FilesLayout
  membership?: OrganizationPermissionSubject
  params?: Record<string, string>
} = {}): void {
  const view = fileListState.parse(params)
  const activeFolder =
    shownFolders.find(
      (folder: AccessibleDocumentFolder): boolean =>
        folder.id === view.filters.folderId
    ) ?? null

  document.body.innerHTML = renderToStaticMarkup(
    <FilesWorkspace
      actions={actions}
      activeFolder={activeFolder}
      cards={new Map(cards.map((card: DocumentCard) => [card.id, card]))}
      documents={shownDocuments}
      folders={shownFolders}
      layout={layout}
      membership={membership}
      organizationId={ORG_ID}
      path={activeFolder ? [activeFolder] : []}
      savedViews={[]}
      view={view}
    />
  )
}

function readNames(attribute?: "href"): Array<string | null | undefined> {
  return [...document.querySelectorAll('[data-slot="file-name"]')].map(
    (link: Element): string | null | undefined =>
      attribute ? link.getAttribute(attribute) : link.textContent
  )
}

function readNotes(): Array<string | null> {
  return [...document.querySelectorAll('[data-slot="file-retention"]')].map(
    (note: Element): string | null => note.textContent
  )
}

function readActionTargets(): string[] {
  return [
    ...document.querySelectorAll('button[aria-label^="Actions for "]'),
  ].map(
    (button: Element): string =>
      button.getAttribute("aria-label")?.replace("Actions for ", "") ?? ""
  )
}

function hasNewButton(): boolean {
  return [...document.querySelectorAll("button")].some(
    (button: Element): boolean => button.textContent === "New"
  )
}

describe("FilesWorkspace", () => {
  it("lists the open location, folders first, and reaches the whole view when searched", () => {
    renderWorkspace()

    expect(document.querySelector("h1")?.textContent).toBe("Files 4")
    expect(readNames()).toEqual([
      "Contracts",
      "Leases",
      "Welcome pack",
      "Zoning letter",
    ])
    // Folders open in place; a generated document opens in the editor, an upload on its page.
    expect(readNames("href")).toEqual([
      `/documents?folderId=${CONTRACTS_ID}`,
      `/documents?folderId=${LEASES_ID}`,
      `/documents/${WELCOME_ID}/edit`,
      `/documents/${ZONING_ID}`,
    ])

    renderWorkspace({ params: { folderId: CONTRACTS_ID, sort: "-modified" } })

    expect(readNames()).toEqual([
      "Signed",
      "Mutual NDA",
      "Master services agreement",
    ])
    const path = document.querySelector('nav[aria-label="Folder path"]')
    expect(path?.querySelector("a")?.getAttribute("href")).toBe(
      "/documents?sort=-modified"
    )
    expect(path?.querySelector('[aria-current="page"]')?.textContent).toBe(
      "Contracts"
    )

    renderWorkspace({ params: { folderId: CONTRACTS_ID, q: "nda" } })

    expect(readNames()).toEqual(["Mutual NDA"])

    // A search reaches the whole view, and each result says where it is filed.
    renderWorkspace({ params: { q: "nda" } })

    expect(readNames()).toEqual(["Mutual NDA"])
    expect(readNotes()).toEqual(["Files › Contracts"])
  })

  it("offers each item's actions only where the member may manage it", () => {
    renderWorkspace({
      documents: [zoning, { ...welcome, accessLevel: "viewer" }],
      folders: [leases, { ...contracts, accessLevel: "viewer" }],
    })

    // A viewer-level item offers no lifecycle changes but can still be shared by someone who manages folders.
    expect(readActionTargets()).toEqual(["Contracts", "Leases", "Welcome pack", "Zoning letter"])
    expect(hasNewButton()).toBe(true)

    // Staff may add documents but not archive, trash, or delete anything; they can still share what they can edit.
    renderWorkspace({ documents: [zoning, { ...welcome, accessLevel: "viewer" }], folders: [], membership: "staff" })

    expect(readActionTargets()).toEqual([zoning.title])
    expect(hasNewButton()).toBe(true)

    // A reviewer only ever views, so has no menu at all.
    renderWorkspace({
      documents: [{ ...zoning, accessLevel: "viewer" }],
      folders: [{ ...leases, accessLevel: "viewer" }],
      membership: "external_reviewer",
    })

    expect(readActionTargets()).toEqual([])
    expect(hasNewButton()).toBe(false)

    // An uploaded form opens in Flow only for someone who may start the template it becomes.
    const pdf: DocumentCard = { content: null, contentType: "application/pdf", id: zoning.id, workflowStatus: null }
    renderWorkspace({ cards: [pdf], documents: [{ ...zoning, accessLevel: "viewer" }], folders: [], membership: { customPermissions: ["documents:view"], role: "staff" } })
    expect(readActionTargets()).toEqual([])

    renderWorkspace({ cards: [pdf], documents: [{ ...zoning, accessLevel: "viewer" }], folders: [], membership: { customPermissions: ["documents:view", "templates:create"], role: "staff" } })
    expect(readActionTargets()).toEqual([zoning.title])
  })

  it("adds new files only among active files the member may add to", () => {
    renderWorkspace({ params: { view: "archived" } })

    expect(hasNewButton()).toBe(false)

    renderWorkspace({
      folders: [{ ...contracts, accessLevel: "viewer" }],
      params: { folderId: CONTRACTS_ID },
    })

    expect(hasNewButton()).toBe(false)
  })

  it("says how long each trashed item stays recoverable, and offers nothing once its purge is queued", () => {
    renderWorkspace({
      documents: [
        {
          ...zoning,
          lifecycleState: "trashed",
          purgeAfter: "2026-10-12T09:00:00.000Z",
        },
        { ...welcome, lifecycleState: "purge_pending" },
      ],
      folders: [{ ...leases, lifecycleState: "trashed" }],
      params: { view: "trash" },
    })

    const notes = [
      ...document.querySelectorAll('[data-slot="file-retention"]'),
    ].map((note: Element): string | null => note.textContent)
    expect(notes).toEqual([
      "Won't be deleted automatically",
      "Permanent deletion pending",
      expect.stringMatching(/^Deletes on Oct 1[12], 2026$/),
    ])
    expect(readActionTargets()).toEqual(["Leases", "Zoning letter"])

    renderWorkspace({ documents: [], folders: [], params: { view: "trash" } })

    expect(document.querySelector('p[role="status"]')?.textContent).toBe(
      "Trash is empty."
    )
  })
})
