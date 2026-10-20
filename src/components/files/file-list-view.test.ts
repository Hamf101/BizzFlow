import { describe, expect, it } from "vitest"

import {
  describeDocumentKind,
  fileListState,
  getDocumentHref,
  getDocumentScope,
  isFilesReturnPath,
} from "@/components/files/file-list-view"
import type { AccessibleDocumentSummary } from "@/types/document"

describe("sheets in Files", () => {
  it("opens a sheet in its editor and calls it a Sheet, until it is in Trash", () => {
    const sheet = { id: "sheet-1", lifecycleState: "active", sourceKind: "sheet" } as AccessibleDocumentSummary

    expect([getDocumentHref(sheet), describeDocumentKind(sheet)]).toEqual(["/documents/sheet-1/edit", "Sheet"])
    expect(getDocumentHref({ ...sheet, lifecycleState: "archived" })).toBe("/documents/sheet-1/edit")
    expect(getDocumentHref({ ...sheet, lifecycleState: "trashed" })).toBe("/documents/sheet-1")
    expect(describeDocumentKind({ ...sheet, sourceKind: "upload" })).toBe("File")
  })
})

describe("isFilesReturnPath", () => {
  it("sends people back only to a Files address", () => {
    expect(isFilesReturnPath("/documents")).toBe(true)
    expect(
      isFilesReturnPath(
        "/documents?folderId=40000000-0000-4000-8000-000000000001&sort=-modified"
      )
    ).toBe(true)
    expect(isFilesReturnPath("//evil.example/documents")).toBe(false)
    expect(isFilesReturnPath("https://evil.example/documents")).toBe(false)
    expect(isFilesReturnPath("/documents/../settings")).toBe(false)
    expect(isFilesReturnPath("/documents-archive")).toBe(false)
  })
})

describe("getDocumentScope", () => {
  const OPEN = "40000000-0000-4000-8000-000000000011"
  const INSIDE = "40000000-0000-4000-8000-000000000012"
  const SIBLING = "40000000-0000-4000-8000-000000000013"
  const DEEP = "40000000-0000-4000-8000-000000000014"
  const folders = [
    { id: OPEN, parentFolderId: null },
    { id: INSIDE, parentFolderId: OPEN },
    { id: SIBLING, parentFolderId: null },
    { id: DEEP, parentFolderId: SIBLING },
  ]
  const scope = (
    layout: "columns" | "icons",
    folderId: string | undefined,
    path: string[]
  ): { folderIds: string[]; includeRoot: boolean } =>
    getDocumentScope(
      layout,
      fileListState.parse(folderId ? { folderId } : {}),
      folders,
      path.map((id: string) => ({ id }))
    )

  it("reads what the layout draws, and nothing beside it", () => {
    // One folder open: itself, and the subfolder whose tile counts its items.
    expect(scope("icons", OPEN, [OPEN])).toEqual({
      folderIds: [OPEN, INSIDE],
      includeRoot: false,
    })
    // Columns draws every level down from the top of Files.
    expect(scope("columns", INSIDE, [OPEN, INSIDE])).toEqual({
      folderIds: [OPEN, INSIDE, SIBLING],
      includeRoot: true,
    })
    // The top of Files draws only what is loose and the folders on it.
    expect(scope("icons", undefined, [])).toEqual({
      folderIds: [OPEN, SIBLING],
      includeRoot: true,
    })
  })
})
