import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createFolder,
  getDocumentDetail,
  listFolderDocuments,
  listRecentDocuments,
  listWorkspaceFolders,
} from "@/services/document-service"
import {
  createDeps,
  createDocumentRow,
  createFolderRow,
  createMembershipRow,
  createVersionRow,
  FakeSupabaseClient,
  type FakeRow,
} from "@/services/document-service.test-support"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe("document service setup failures", () => {
  it("reports missing server credentials with a setup-specific error", async () => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      // An ambient secret key would turn this into a network call.
      SUPABASE_SECRET_KEY: undefined,
    }

    await expect(
      listWorkspaceFolders({
        actorUserId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toMatchObject({
      message: "Supabase server credentials are not configured.",
      statusCode: 500,
    })
  })
})

describe("document service permissions", () => {
  it("rejects folder creation when the actor cannot manage folders", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("external_reviewer")],
    })
    const deps = createDeps(client, ["folder-1"])

    await expect(
      createFolder(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          name: "Client files",
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "You cannot manage folders.",
      statusCode: 403,
    })

    expect(client.tables.folders).toHaveLength(0)
  })
})

describe("ACL-aware document workspace", () => {
  it("reads the folders a view draws, never a sibling's documents", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      folders: [
        createFolderRow({ id: "folder-open", name: "Open" }),
        createFolderRow({
          id: "folder-inside",
          name: "Inside",
          parent_folder_id: "folder-open",
        }),
        createFolderRow({ id: "folder-sibling", name: "Sibling" }),
      ],
      documents: [
        createDocumentRow({ id: "document-here", folder_id: "folder-open" }),
        createDocumentRow({
          id: "document-counted",
          folder_id: "folder-inside",
        }),
        createDocumentRow({
          id: "document-elsewhere",
          folder_id: "folder-sibling",
        }),
        createDocumentRow({ id: "document-loose" }),
      ],
    })
    const deps = createDeps(client)
    const folders = await listWorkspaceFolders(
      { actorUserId: "user-1", organizationId: "org-1" },
      deps
    )

    const documents = await listFolderDocuments(
      {
        actorUserId: "user-1",
        // What Files draws with "Open" open: the folder, and the subfolder
        // whose contents its tile counts.
        folderIds: ["folder-open", "folder-inside"],
        includeRoot: false,
        organizationId: "org-1",
        visibleFolderIds: folders.map(
          (folder: { id: string }): string => folder.id
        ),
      },
      deps
    )

    expect(documents.map((document) => document.id).sort()).toEqual([
      "document-counted",
      "document-here",
    ])
    expect(
      client.rpcCalls.find(
        ({ functionName }) => functionName === "list_workspace_documents"
      )?.args
    ).toMatchObject({
      target_folder_ids: ["folder-open", "folder-inside"],
      target_include_root: false,
    })
  })

  it("never lists another organization's files", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [
        createMembershipRow("owner_admin"),
        { ...createMembershipRow("owner_admin"), id: "membership-other", org_id: "org-2" },
      ],
      folders: [
        createFolderRow({ id: "folder-shared-id" }),
        createFolderRow({ id: "folder-shared-id", org_id: "org-2", name: "Theirs" }),
      ],
      documents: [
        createDocumentRow({ folder_id: "folder-shared-id", id: "ours" }),
        createDocumentRow({
          folder_id: "folder-shared-id",
          id: "theirs",
          org_id: "org-2",
          title: "Their lease",
        }),
      ],
    })
    const deps = createDeps(client)
    const ours = {
      actorUserId: "user-1",
      folderIds: ["folder-shared-id"],
      includeRoot: true,
      organizationId: "org-1",
      visibleFolderIds: ["folder-shared-id"],
    }

    await expect(
      listWorkspaceFolders({ actorUserId: "user-1", organizationId: "org-1" }, deps).then(
        (folders) => folders.map((folder) => folder.name)
      )
    ).resolves.toEqual(["Client files"])
    await expect(
      listFolderDocuments(ours, deps).then((documents) =>
        documents.map((document) => document.id)
      )
    ).resolves.toEqual(["ours"])
    // Not even by name: a search is scoped to the organization too.
    await expect(
      listFolderDocuments({ ...ours, query: "lease" }, deps).then((documents) =>
        documents.map((document) => document.id)
      )
    ).resolves.toEqual([])
  })

  it("searches the whole view, and only what the member may open", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      folders: [
        createFolderRow({ id: "folder-open", name: "Open" }),
        createFolderRow({ id: "folder-private", name: "Private", created_by: "user-2" }),
      ],
      documents: [
        createDocumentRow({ id: "document-here", folder_id: "folder-open", title: "Lease here" }),
        createDocumentRow({
          created_by: "user-2",
          folder_id: "folder-private",
          id: "document-away",
          title: "Lease renewal",
        }),
        createDocumentRow({
          created_by: "user-2",
          folder_id: "folder-private",
          id: "document-secret",
          title: "Lease nobody shared",
        }),
      ],
      document_access_grants: [createDocumentGrant("document-away")],
    })
    const deps = createDeps(client)

    const found = await listFolderDocuments(
      {
        actorUserId: "user-1",
        folderIds: ["folder-open"],
        includeRoot: false,
        organizationId: "org-1",
        query: "lease",
        visibleFolderIds: ["folder-open"],
      },
      deps
    )

    // Filed elsewhere, so only a search reaches it; and only with a grant.
    expect(found.map((document) => document.id).sort()).toEqual([
      "document-away",
      "document-here",
    ])
    // It is in a folder this member cannot see, so where stays hidden.
    expect(found.find((document) => document.id === "document-away")?.folderId).toBeNull()
  })

  it("exposes effective access and lists at the top what its folder hides", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      folders: [
        createFolderRow({
          id: "archived-parent",
          lifecycle_state: "archived",
          archived_at: "2026-07-28T12:00:00.000Z",
          created_by: "user-2",
        }),
        createFolderRow({
          id: "visible-child",
          parent_folder_id: "archived-parent",
          created_by: "user-2",
        }),
      ],
      folder_access_grants: [
        {
          id: "folder-grant-1",
          org_id: "org-1",
          folder_id: "visible-child",
          user_id: "user-1",
          organization_role: null,
          access_level: "viewer",
        },
      ],
      documents: [
        createDocumentRow({
          id: "document-1",
          folder_id: "visible-child",
          created_by: "user-2",
        }),
        createDocumentRow({
          id: "document-2",
          folder_id: "missing-folder",
          created_by: "user-2",
        }),
      ],
      document_access_grants: [
        createDocumentGrant("document-1"),
        createDocumentGrant("document-2"),
      ],
    })
    const deps = createDeps(client)
    const folders = await listWorkspaceFolders(
      { actorUserId: "user-1", organizationId: "org-1" },
      deps
    )
    const visibleFolderIds = folders.map(
      (folder: { id: string }): string => folder.id
    )

    expect(folders).toEqual([
      expect.objectContaining({
        id: "visible-child",
        parentFolderId: null,
        accessLevel: "viewer",
      }),
    ])
    await expect(
      listFolderDocuments(
        {
          actorUserId: "user-1",
          folderIds: visibleFolderIds,
          includeRoot: true,
          organizationId: "org-1",
          visibleFolderIds,
        },
        deps
      )
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "document-1",
          folderId: "visible-child",
          accessLevel: "viewer",
        }),
        expect.objectContaining({
          id: "document-2",
          folderId: null,
          accessLevel: "viewer",
        }),
      ])
    )
  })

  it("includes both recoverable and purge-pending resources in Trash, and nothing active", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      folders: [
        createFolderRow({ id: "trashed-folder", lifecycle_state: "trashed" }),
        createFolderRow({ id: "purge-folder", lifecycle_state: "purge_pending" }),
        createFolderRow({ id: "active-folder" }),
      ],
      documents: [
        createDocumentRow({ id: "trashed-document", lifecycle_state: "trashed" }),
        createDocumentRow({
          id: "purge-document",
          lifecycle_state: "purge_pending",
        }),
        createDocumentRow({ id: "active-document" }),
      ],
    })
    const deps = createDeps(client)
    const trash = {
      actorUserId: "user-1",
      lifecycleState: "trashed",
      organizationId: "org-1",
    } as const
    const folders = await listWorkspaceFolders(trash, deps)
    const visibleFolderIds = folders.map(
      (folder: { id: string }): string => folder.id
    )

    expect(visibleFolderIds.slice().sort()).toEqual([
      "purge-folder",
      "trashed-folder",
    ])
    await expect(
      listFolderDocuments(
        { ...trash, folderIds: visibleFolderIds, includeRoot: true, visibleFolderIds },
        deps
      ).then((documents) => documents.map((document) => document.id).sort())
    ).resolves.toEqual(["purge-document", "trashed-document"])
  })

  it("lists every document in a folder past the response cap", async () => {
    const client = new FakeSupabaseClient(
      {
        organization_memberships: [createMembershipRow("manager")],
        folders: [createFolderRow({ id: "folder-1" })],
        documents: Array.from({ length: 1_001 }, (_, index: number): FakeRow =>
          createDocumentRow({
            folder_id: "folder-1",
            id: `document-${String(index).padStart(4, "0")}`,
            title: `Document ${index}`,
          })
        ),
      },
      // A deployment may answer with fewer rows than a query asks for.
      400
    )

    const documents = await listFolderDocuments(
      {
        actorUserId: "user-1",
        folderIds: ["folder-1"],
        includeRoot: false,
        organizationId: "org-1",
        visibleFolderIds: ["folder-1"],
      },
      createDeps(client)
    )

    expect(new Set(documents.map((document) => document.id)).size).toBe(1_001)
    expect(
      client.rpcCalls.filter(
        ({ functionName }) => functionName === "list_workspace_documents"
      )
    ).toHaveLength(4)
  })

  it("returns viewer access on trashed document detail for safe lifecycle controls", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      documents: [
        createDocumentRow({
          created_by: "user-2",
          lifecycle_state: "trashed",
          archived_at: "2026-07-28T12:00:00.000Z",
          trashed_at: "2026-07-29T12:00:00.000Z",
          trashed_by: "user-2",
          pre_trash_lifecycle_state: "active",
          trash_operation_id: "trash-operation-1",
        }),
      ],
      document_access_grants: [createDocumentGrant("document-1")],
      document_versions: [createVersionRow()],
    })

    const detail = await getDocumentDetail(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
      },
      createDeps(client)
    )

    expect(detail.document).toMatchObject({
      id: "document-1",
      lifecycleState: "trashed",
      accessLevel: "viewer",
    })
    expect(detail.versions).toHaveLength(1)
  })
})

describe("recent documents", () => {
  it("lists only what the member may open, newest first, and hides where it is filed", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [
        createDocumentRow({ id: "old-shared", created_by: "user-2", updated_at: "2026-07-01T09:00:00.000Z" }),
        createDocumentRow({ id: "new-private", created_by: "user-2", updated_at: "2026-07-03T09:00:00.000Z" }),
        createDocumentRow({ id: "new-shared", created_by: "user-2", folder_id: "hidden-folder", updated_at: "2026-07-02T09:00:00.000Z" }),
        createDocumentRow({ id: "mine-sent", source_kind: "generated", updated_at: "2026-06-30T09:00:00.000Z" }),
        createDocumentRow({ id: "trashed-shared", created_by: "user-2", lifecycle_state: "trashed", updated_at: "2026-07-04T09:00:00.000Z" }),
      ],
      document_access_grants: [
        createDocumentGrant("old-shared"),
        createDocumentGrant("new-shared"),
        createDocumentGrant("trashed-shared"),
      ],
    })
    const list = (input: { generatedBy?: string; limit: number }) =>
      listRecentDocuments({ actorUserId: "user-1", organizationId: "org-1", ...input }, createDeps(client))

    expect((await list({ limit: 2 })).map((document) => [document.id, document.folderId])).toEqual([
      ["new-shared", null],
      ["old-shared", null],
    ])
    expect((await list({ generatedBy: "user-1", limit: 5 })).map((document) => document.id)).toEqual(["mine-sent"])
  })
})

describe("folder creation beside a colleague's write", () => {
  it("creates the folder once the database stops asking for a retry, and asks the member to try again when it never does", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
    })
    client.failNextWrites("folders", "40001")

    await expect(
      createFolder(
        { actorUserId: "user-1", name: "Leases", organizationId: "org-1" },
        createDeps(client, ["folder-1"])
      )
    ).resolves.toMatchObject({ id: "folder-1", name: "Leases" })

    client.failNextWrites("folders", "40001", 4)

    await expect(
      createFolder(
        { actorUserId: "user-1", name: "Deeds", organizationId: "org-1" },
        createDeps(client, ["folder-2"])
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(client.tables.folders.map((folder: FakeRow) => folder.name)).toEqual([
      "Leases",
    ])
  })
})

function createDocumentGrant(documentId: string): FakeRow {
  return {
    id: `grant-${documentId}`,
    org_id: "org-1",
    document_id: documentId,
    user_id: "user-1",
    organization_role: null,
    access_level: "viewer",
  }
}
