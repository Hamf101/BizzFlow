import { describe, expect, it } from "vitest"

import { isFilesReturnPath } from "@/components/files/file-list-view"

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
