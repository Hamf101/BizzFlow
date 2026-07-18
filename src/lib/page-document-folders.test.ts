import { describe, expect, it } from "vitest"

import { buildDocumentFolderPath } from "@/lib/page-document-folders"
import type { DocumentFolder } from "@/types/document"

describe("document folder page paths", () => {
  it("orders the reachable folder ancestry from root to leaf", () => {
    const root = createFolder("root", null)
    const child = createFolder("child", root.id)
    const leaf = createFolder("leaf", child.id)

    expect(buildDocumentFolderPath(leaf, [leaf, root, child])).toEqual([
      root,
      child,
      leaf,
    ])
  })

  it("stops at the first repeated folder when parent data is cyclic", () => {
    const first = createFolder("first", "second")
    const second = createFolder("second", "first")

    expect(buildDocumentFolderPath(first, [first, second])).toEqual([
      second,
      first,
    ])
  })
})

function createFolder(
  id: string,
  parentFolderId: string | null
): DocumentFolder {
  return {
    id,
    organizationId: "organization-1",
    parentFolderId,
    name: id,
    createdBy: "user-1",
    updatedBy: "user-1",
    archivedBy: null,
    archivedAt: null,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
  }
}
