import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createFolder,
  getDocumentDetail,
  listDocumentWorkspace,
} from "@/services/document-service"
import {
  createDeps,
  createDocumentRow,
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
    }

    await expect(
      listDocumentWorkspace({
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
  it("exposes effective access and promotes items whose parent is absent from the view", async () => {
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

    const workspace = await listDocumentWorkspace(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
      },
      createDeps(client)
    )

    expect(workspace.folders).toEqual([
      expect.objectContaining({
        id: "visible-child",
        parentFolderId: null,
        accessLevel: "viewer",
      }),
    ])
    expect(workspace.documents).toEqual(
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

  it("includes both recoverable and purge-pending resources in Trash", async () => {
    const client = new FakeWorkspaceClient({
      organization_memberships: [createMembershipRow("manager")],
      folders: [
        createFolderRow({
          id: "trashed-folder",
          lifecycle_state: "trashed",
        }),
        createFolderRow({
          id: "purge-folder",
          lifecycle_state: "purge_pending",
        }),
      ],
      documents: [
        createDocumentRow({
          id: "trashed-document",
          lifecycle_state: "trashed",
        }),
        createDocumentRow({
          id: "purge-document",
          lifecycle_state: "purge_pending",
        }),
      ],
    })

    const workspace = await listDocumentWorkspace(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        lifecycleState: "trashed",
      },
      {
        client: client as never,
      }
    )

    expect(workspace.folders.map((folder) => folder.id)).toEqual(
      expect.arrayContaining(["purge-folder", "trashed-folder"])
    )
    expect(workspace.documents.map((document) => document.id)).toEqual(
      expect.arrayContaining(["purge-document", "trashed-document"])
    )
    expect(client.lifecycleFilters).toEqual([
      ["trashed", "purge_pending"],
      ["trashed", "purge_pending"],
    ])
  })

  it("bounds concurrent per-resource access lookups", async () => {
    const client = new FakeWorkspaceClient({
      organization_memberships: [createMembershipRow("manager")],
      folders: Array.from({ length: 20 }, (_, index: number): FakeRow =>
        createFolderRow({
          id: `folder-${index}`,
          name: `Folder ${String(index).padStart(2, "0")}`,
        })
      ),
      documents: Array.from({ length: 20 }, (_, index: number): FakeRow =>
        createDocumentRow({
          id: `document-${index}`,
          title: `Document ${String(index).padStart(2, "0")}`,
        })
      ),
    })

    const workspace = await listDocumentWorkspace(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
      },
      {
        client: client as never,
      }
    )

    expect(workspace.folders).toHaveLength(20)
    expect(workspace.documents).toHaveLength(20)
    expect(client.maxConcurrentAccessRequests).toBe(8)
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

type FakeWorkspaceTables = {
  organization_memberships: FakeRow[]
  folders: FakeRow[]
  documents: FakeRow[]
}

class FakeWorkspaceClient {
  readonly lifecycleFilters: string[][] = []
  maxConcurrentAccessRequests = 0
  private readonly tables: FakeWorkspaceTables
  private activeAccessRequests = 0

  constructor(tables: FakeWorkspaceTables) {
    this.tables = tables
  }

  from(tableName: keyof FakeWorkspaceTables): FakeWorkspaceQuery {
    return new FakeWorkspaceQuery(
      this.tables[tableName],
      this.lifecycleFilters
    )
  }

  async rpc(
    functionName: string,
    args: Record<string, unknown>
  ): Promise<{ data: string | null; error: null }> {
    void args
    const isAccessLookup =
      functionName === "get_document_access_level" ||
      functionName === "get_folder_access_level"

    if (isAccessLookup) {
      this.activeAccessRequests += 1
      this.maxConcurrentAccessRequests = Math.max(
        this.maxConcurrentAccessRequests,
        this.activeAccessRequests
      )
      await Promise.resolve()
      this.activeAccessRequests -= 1
    }

    return {
      data: isAccessLookup ? "contributor" : null,
      error: null,
    }
  }
}

class FakeWorkspaceQuery {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private orderColumn: string | null = null
  private orderAscending = true

  constructor(
    private readonly rows: FakeRow[],
    private readonly lifecycleFilters: string[][]
  ) {}

  select(columns: string): FakeWorkspaceQuery {
    void columns
    return this
  }

  eq(column: string, value: unknown): FakeWorkspaceQuery {
    this.filters.push((row: FakeRow): boolean => row[column] === value)
    return this
  }

  in(column: string, values: readonly unknown[]): FakeWorkspaceQuery {
    this.filters.push(
      (row: FakeRow): boolean => values.includes(row[column])
    )

    if (column === "lifecycle_state") {
      this.lifecycleFilters.push(values.map(String))
    }

    return this
  }

  order(
    column: string,
    options: { ascending?: boolean } = {}
  ): FakeWorkspaceQuery {
    this.orderColumn = column
    this.orderAscending = options.ascending ?? true
    return this
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: null }> {
    return {
      data: this.execute()[0] ?? null,
      error: null,
    }
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: FakeRow[]; error: null }
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private execute(): FakeRow[] {
    const rows = this.rows.filter((row: FakeRow): boolean =>
      this.filters.every(
        (filter: (candidate: FakeRow) => boolean): boolean =>
          filter(row)
      )
    )

    if (!this.orderColumn) {
      return rows
    }

    return [...rows].sort((left: FakeRow, right: FakeRow): number => {
      const leftValue = String(left[this.orderColumn ?? ""])
      const rightValue = String(right[this.orderColumn ?? ""])
      return this.orderAscending
        ? leftValue.localeCompare(rightValue)
        : rightValue.localeCompare(leftValue)
    })
  }
}

function createFolderRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: "folder-1",
    org_id: "org-1",
    parent_folder_id: null,
    name: "Client files",
    lifecycle_state: "active",
    created_by: "user-1",
    updated_by: "user-1",
    archived_by: null,
    archived_at: null,
    trashed_by: null,
    trashed_at: null,
    purge_after: null,
    pre_trash_lifecycle_state: null,
    trash_operation_id: null,
    created_at: "2026-07-28T12:00:00.000Z",
    updated_at: "2026-07-28T12:00:00.000Z",
    ...overrides,
  }
}

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
