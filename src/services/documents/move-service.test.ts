import { describe, expect, it } from "vitest"

import { moveDocument, moveFolder } from "@/services/document-service"
import {
  createDeps,
  createDocumentRow,
  createFolderRow,
  createMembershipRow,
  FakeSupabaseClient,
} from "@/services/document-service.test-support"

const ACTOR = { actorUserId: "user-1", organizationId: "org-1" }

describe("moving files", (): void => {
  it("puts a file in another folder and remembers where it came from", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [
        createFolderRow({ id: "folder-1" }),
        createFolderRow({ id: "folder-2", name: "Signed" }),
      ],
      documents: [createDocumentRow({ folder_id: "folder-1" })],
    })
    const deps = createDeps(client)

    const document = await moveDocument(
      { ...ACTOR, documentId: "document-1", folderId: "folder-2" },
      deps
    )

    expect(document.folderId).toBe("folder-2")
    expect(client.tables.documents[0]?.folder_id).toBe("folder-2")
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.moved",
        targetId: "document-1",
        metadata: expect.objectContaining({
          fromFolderId: "folder-1",
          toFolderId: "folder-2",
        }),
      })
    )
  })

  it("takes a file back out to the top level", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [createFolderRow({ id: "folder-1" })],
      documents: [createDocumentRow({ folder_id: "folder-1" })],
    })

    const document = await moveDocument(
      { ...ACTOR, documentId: "document-1", folderId: null },
      createDeps(client)
    )

    expect(document.folderId).toBeNull()
    expect(client.tables.documents[0]?.folder_id).toBeNull()
  })

  it("leaves a file where it is when the destination is not active", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [
        createFolderRow({ id: "folder-1" }),
        createFolderRow({
          id: "folder-2",
          archived_at: "2026-09-01T12:00:00.000Z",
          lifecycle_state: "archived",
        }),
      ],
      documents: [createDocumentRow({ folder_id: "folder-1" })],
    })

    await expect(
      moveDocument(
        { ...ACTOR, documentId: "document-1", folderId: "folder-2" },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 404 })
    expect(client.tables.documents[0]?.folder_id).toBe("folder-1")
  })

  it("refuses to move a file that is in Trash", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [createFolderRow({ id: "folder-2" })],
      documents: [
        createDocumentRow({
          lifecycle_state: "trashed",
          trashed_at: "2026-09-01T12:00:00.000Z",
        }),
      ],
    })

    await expect(
      moveDocument(
        { ...ACTOR, documentId: "document-1", folderId: "folder-2" },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it("moves a folder under another one", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [
        createFolderRow({ id: "folder-1" }),
        createFolderRow({ id: "folder-2", name: "Signed" }),
      ],
    })
    const deps = createDeps(client)

    const folder = await moveFolder(
      { ...ACTOR, folderId: "folder-1", parentFolderId: "folder-2" },
      deps
    )

    expect(folder.parentFolderId).toBe("folder-2")
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "folder.moved",
        targetId: "folder-1",
        metadata: expect.objectContaining({ toFolderId: "folder-2" }),
      })
    )
  })

  it("says so plainly when a folder would end up inside itself", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [
        createFolderRow({ id: "folder-1" }),
        createFolderRow({ id: "folder-2", parent_folder_id: "folder-1" }),
      ],
    })
    // The database's cycle trigger answers 23514 for a folder moved into its
    // own branch, which the service has to turn into words a person can act on.
    client.failNextWrites("folders", "23514")

    await expect(
      moveFolder(
        { ...ACTOR, folderId: "folder-1", parentFolderId: "folder-2" },
        createDeps(client)
      )
    ).rejects.toMatchObject({
      message: "A folder cannot move inside itself.",
      statusCode: 409,
    })
  })

  it("asks again for a busy folder tree, then gives up in words", async (): Promise<void> => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("owner_admin")],
      folders: [
        createFolderRow({ id: "folder-1" }),
        createFolderRow({ id: "folder-2" }),
        createFolderRow({ id: "folder-3" }),
      ],
    })
    client.failNextWrites("folders", "40001")

    const folder = await moveFolder(
      { ...ACTOR, folderId: "folder-1", parentFolderId: "folder-2" },
      createDeps(client)
    )

    expect(folder.parentFolderId).toBe("folder-2")

    client.failNextWrites("folders", "40001", 4)

    await expect(
      moveFolder(
        { ...ACTOR, folderId: "folder-2", parentFolderId: "folder-3" },
        createDeps(client)
      )
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})
