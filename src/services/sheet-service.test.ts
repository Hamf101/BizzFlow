import { describe, expect, it } from "vitest"

import { book } from "@/lib/sheet/sheet.test-support"
import {
  createDeps,
  createDocumentRow,
  createMembershipRow,
  FakeSupabaseClient,
  type FakeRow,
} from "@/services/document-service.test-support"
import { listFolderDocuments } from "@/services/document-service"
import { createSheet, getSheet, renameSheet, updateSheetContent } from "@/services/sheet-service"

const ORG = "org-1"
const STAMP = "2026-07-09T11:00:00.000Z"
const sheetRow = (overrides: FakeRow = {}): FakeRow =>
  createDocumentRow({ id: "sheet-1", title: "Budget", source_kind: "sheet", current_version_id: null, sheet_content: book({ A1: 1 }), ...overrides })
const member = (userId: string, role: "staff" | "external_reviewer" = "staff"): FakeRow => ({ ...createMembershipRow(role), id: `m-${userId}`, user_id: userId })
const grant = (userId: string, level: "viewer" | "contributor"): FakeRow => ({ org_id: ORG, document_id: "sheet-1", user_id: userId, access_level: level })

function setUp() {
  const client = new FakeSupabaseClient({
    organization_memberships: [createMembershipRow("staff"), member("viewer-1"), member("other-1")].map((row) =>
      row.user_id === "other-1" ? { ...row, org_id: "org-2" } : row
    ),
    documents: [sheetRow(), createDocumentRow()],
    document_access_grants: [grant("viewer-1", "viewer")],
    document_guest_grants: [
      { ...grant("guest-viewer", "viewer"), accepted_at: STAMP },
      { ...grant("guest-editor", "contributor"), accepted_at: STAMP },
    ],
  })
  const deps = { ...createDeps(client, ["new-sheet"]), now: () => new Date("2026-07-09T12:00:00.000Z") }
  const as = (actorUserId: string, organizationId = ORG) => ({ actorUserId, organizationId, documentId: "sheet-1" })

  return { as, client, deps }
}

describe("sheet service", () => {
  it("creates an empty one-tab sheet that Files lists as a sheet", async () => {
    const { client, deps } = setUp()

    const created = await createSheet({ actorUserId: "user-1", organizationId: ORG, title: "  Q3 plan " }, deps)
    const listed = await listFolderDocuments(
      { actorUserId: "user-1", organizationId: ORG, folderIds: [], includeRoot: true, visibleFolderIds: [] },
      deps
    )

    expect(created).toMatchObject({ id: "new-sheet", title: "Q3 plan", sourceKind: "sheet" })
    expect(client.tables.documents.find((row) => row.id === "new-sheet")?.sheet_content).toEqual({
      version: 1,
      tabs: [{ id: "t1", name: "Sheet1", cells: {} }],
    })
    expect(listed.find((document) => document.id === "new-sheet")?.sourceKind).toBe("sheet")
    expect(deps.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "document.created", targetId: "new-sheet" }))
  })

  it("opens a sheet at each reader's level and hides it from everyone else", async () => {
    const { as, deps } = setUp()

    await expect(getSheet(as("user-1"), deps)).resolves.toMatchObject({ accessLevel: "contributor", content: book({ A1: 1 }), updatedAt: STAMP })
    await expect(getSheet(as("viewer-1"), deps)).resolves.toMatchObject({ accessLevel: "viewer" })
    await expect(getSheet(as("guest-viewer"), deps)).resolves.toMatchObject({ accessLevel: "viewer" })
    await expect(getSheet(as("other-1", "org-2"), deps)).rejects.toMatchObject({ statusCode: 404 })
    // An uploaded file is no sheet.
    await expect(getSheet({ ...as("user-1"), documentId: "document-1" }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("saves content for writers only, and only over the version they opened", async () => {
    const { as, client, deps } = setUp()
    const content = book({ A1: 2, A2: "=A1*3" })

    const saved = await updateSheetContent({ ...as("user-1"), content, expectedUpdatedAt: STAMP }, deps)

    expect(saved.updatedAt).not.toBe(STAMP)
    expect(client.tables.documents.find((row) => row.id === "sheet-1")?.sheet_content).toEqual(content)
    // Saved over by someone else since it was opened.
    await expect(updateSheetContent({ ...as("user-1"), content, expectedUpdatedAt: STAMP }, deps)).rejects.toMatchObject({ statusCode: 409 })
    await expect(updateSheetContent({ ...as("guest-editor"), content, expectedUpdatedAt: saved.updatedAt }, deps)).resolves.toBeTruthy()
    for (const viewer of ["viewer-1", "guest-viewer"]) {
      await expect(updateSheetContent({ ...as(viewer), content, expectedUpdatedAt: STAMP }, deps)).rejects.toMatchObject({ statusCode: 403 })
    }
    await expect(updateSheetContent({ ...as("other-1", "org-2"), content, expectedUpdatedAt: STAMP }, deps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("refuses content past the caps or too heavy to work out, and takes a long chain", async () => {
    const { as, client, deps } = setUp()
    const save = (content: unknown) =>
      updateSheetContent({ ...as("user-1"), content, expectedUpdatedAt: String(client.tables.documents[0]!.updated_at) }, deps)
    const rows = (count: number, cell: (row: number) => string | number) =>
      Object.fromEntries(Array.from({ length: count }, (_, at) => [`A${at + 1}`, cell(at + 1)]))
    const wide = book(Object.fromEntries(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "AA", "AB", "AC", "AD"].flatMap((column) =>
      Array.from({ length: 2000 }, (_, at) => [`${column}${at + 1}`, at])
    )))
    const heavy = book(Object.fromEntries(Array.from({ length: 2000 }, (_, at) => [`AZ${at + 1}`, "=SUM(A1:AY2000)+SUM(A1:AY2000)+SUM(A1:AY2000)"])))

    await expect(save(wide)).rejects.toMatchObject({ statusCode: 400 })
    await expect(save({ version: 1, tabs: [{ id: "t1", name: "Sheet1", cells: { A1: { f: "1", evil: true } } }] })).rejects.toMatchObject({ statusCode: 400 })
    await expect(save(heavy)).rejects.toMatchObject({ statusCode: 422 })
    await expect(save(book(rows(2000, (row) => (row === 1 ? 1 : `=A${row - 1}+1`))))).resolves.toBeTruthy()
  })

  it("renames a sheet for its writers", async () => {
    const { as, client, deps } = setUp()

    await renameSheet({ ...as("user-1"), title: "Budget 2027", expectedUpdatedAt: STAMP }, deps)

    expect(client.tables.documents.find((row) => row.id === "sheet-1")?.title).toBe("Budget 2027")
    await expect(renameSheet({ ...as("viewer-1"), title: "Mine", expectedUpdatedAt: STAMP }, deps)).rejects.toMatchObject({ statusCode: 403 })
  })
})
