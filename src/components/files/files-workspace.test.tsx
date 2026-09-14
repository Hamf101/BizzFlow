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
import { createBlankTemplateContent } from "@/types/template"

const ORG_ID = "10000000-0000-4000-8000-000000000001"
const CONTRACTS_ID = "40000000-0000-4000-8000-000000000001"
const LEASES_ID = "40000000-0000-4000-8000-000000000002"
const SIGNED_ID = "40000000-0000-4000-8000-000000000003"
const WELCOME_ID = "60000000-0000-4000-8000-000000000001"
const ZONING_ID = "60000000-0000-4000-8000-000000000002"
const MSA_ID = "60000000-0000-4000-8000-000000000003"
const NDA_ID = "60000000-0000-4000-8000-000000000004"
const SCAN_ID = "60000000-0000-4000-8000-000000000005"

const welcomePage = {
  ...createBlankTemplateContent(),
  blocks: [
    {
      alignment: "left",
      id: "50000000-0000-4000-8000-000000000009",
      level: 1,
      text: "Welcome to the building",
      type: "heading",
    },
  ],
} as DocumentCard["content"]

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

function readTile(name: string): Element | undefined {
  return [...document.querySelectorAll('[data-slot="file-tile"]')].find(
    (tile: Element): boolean =>
      tile.querySelector('[data-slot="file-name"]')?.textContent === name
  )
}

function readNames(attribute?: "href"): Array<string | null | undefined> {
  return [...document.querySelectorAll('[data-slot="file-name"]')].map(
    (link: Element): string | null | undefined =>
      attribute ? link.getAttribute(attribute) : link.textContent
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
  it("lists only the open location, folders first, in the chosen order, and narrows by search", () => {
    renderWorkspace()

    expect(document.querySelector("h1")?.textContent).toBe("Files 4")
    expect(readNames()).toEqual([
      "Contracts",
      "Leases",
      "Welcome pack",
      "Zoning letter",
    ])
    // Folders open in place; a generated document opens in its editor.
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
  })

  it("offers each item's actions only where the member may manage it", () => {
    renderWorkspace({
      documents: [zoning, { ...welcome, accessLevel: "viewer" }],
      folders: [leases, { ...contracts, accessLevel: "viewer" }],
    })

    expect(readActionTargets()).toEqual(["Leases", "Zoning letter"])
    expect(hasNewButton()).toBe(true)

    // Staff may add documents, but not archive, trash, or delete anything.
    renderWorkspace({ membership: "staff" })

    expect(readActionTargets()).toEqual([])
    expect(hasNewButton()).toBe(true)

    renderWorkspace({ membership: "external_reviewer" })

    expect(readActionTargets()).toEqual([])
    expect(hasNewButton()).toBe(false)
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

  it("draws Icons as real first pages, file tiles, and folders, with status dots and item counts", () => {
    renderWorkspace({
      cards: [
        { content: welcomePage, id: WELCOME_ID, workflowStatus: "awaiting_signatures" },
      ],
      documents: [...documents, createDocument({ id: SCAN_ID, title: "Scan.pdf" })],
      layout: "icons",
    })

    const welcomeTile = readTile("Welcome pack")
    expect(
      welcomeTile?.querySelector('[data-slot="template-page"]')?.textContent
    ).toContain("Welcome to the building")
    expect(
      welcomeTile?.querySelector('[data-slot="file-status"]')?.getAttribute("data-tone")
    ).toBe("warning")
    expect(welcomeTile?.textContent).toContain("Awaiting signatures")
    expect(
      readTile("Scan.pdf")?.querySelector('[data-slot="file-upload-page"]')?.textContent
    ).toBe("PDF")
    expect(
      readTile("Contracts")?.querySelector('[data-slot="file-meta"]')?.textContent
    ).toBe("3 items")
  })

  it("shows Columns as one column per folder along the path and previews the chosen document", () => {
    renderWorkspace({
      layout: "columns",
      params: { folderId: CONTRACTS_ID, item: NDA_ID },
    })

    const columns = [...document.querySelectorAll('[data-slot="file-columns"] ul')]
    expect(columns.map((column: Element) => column.getAttribute("aria-label"))).toEqual([
      "Files",
      "Contracts",
    ])
    expect(columns[0]?.querySelector('[aria-current="true"]')?.textContent).toBe(
      "Contracts"
    )
    expect(
      [...(columns[1]?.querySelectorAll('[data-slot="file-cell"]') ?? [])].map(
        (cell: Element) => cell.textContent
      )
    ).toEqual(["Signed", "Master services agreement", "Mutual NDA"])
    expect(columns[1]?.querySelector('[aria-current="true"]')?.textContent).toBe(
      "Mutual NDA"
    )
    // A drawn page holds the document's own headings, so read the details'.
    const details = document.querySelector(
      '[data-slot="file-preview"] [data-slot="file-details"]'
    )
    expect(details?.querySelector("h2")?.textContent).toBe("Mutual NDA")
    expect(details?.textContent).toContain("Files › Contracts")
  })

  it("stages Gallery's chosen item over the folder's filmstrip, starting at the first document", () => {
    renderWorkspace({ layout: "gallery" })

    const gallery = document.querySelector('[data-slot="file-gallery"]')
    expect(
      gallery?.querySelector('[data-slot="file-details"] h2')?.textContent
    ).toBe("Welcome pack")
    expect(
      [...(gallery?.querySelectorAll('[data-slot="file-film"]') ?? [])].map(
        (film: Element) => film.getAttribute("title")
      )
    ).toEqual(["Contracts", "Leases", "Welcome pack", "Zoning letter"])
    expect(
      gallery
        ?.querySelector('[data-slot="file-film"][aria-current="true"]')
        ?.getAttribute("title")
    ).toBe("Welcome pack")
  })

  it("marks the remembered layout and returns to the same folder after a switch", () => {
    renderWorkspace({
      layout: "columns",
      params: { folderId: CONTRACTS_ID, sort: "-modified" },
    })

    expect(
      document
        .querySelector('[aria-label="Layout"] [aria-pressed="true"]')
        ?.getAttribute("aria-label")
    ).toBe("Columns view")
    expect(
      document.querySelector('input[name="returnTo"]')?.getAttribute("value")
    ).toBe(`/documents?folderId=${CONTRACTS_ID}&sort=-modified`)
  })
})
