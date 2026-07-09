import { afterEach, describe, expect, it, vi } from "vitest"

import type { OrganizationRole } from "@/lib/permissions"
import {
  archiveDocument,
  completeDocumentUpload,
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
  createFolder,
  DocumentServiceError,
  listDocumentWorkspace,
  type DocumentServiceDeps,
} from "@/services/document-service"

type FakeRow = Record<string, unknown>

type FakeTableName =
  | "organization_memberships"
  | "folders"
  | "documents"
  | "document_versions"
  | "audit_logs"

type FakeTables = Record<FakeTableName, FakeRow[]>

const originalEnv = { ...process.env }

class FakeSupabaseClient {
  readonly tables: FakeTables

  constructor(seed: Partial<FakeTables> = {}) {
    this.tables = {
      organization_memberships: seed.organization_memberships ?? [],
      folders: seed.folders ?? [],
      documents: seed.documents ?? [],
      document_versions: seed.document_versions ?? [],
      audit_logs: seed.audit_logs ?? [],
    }
  }

  from(tableName: FakeTableName): FakeQueryBuilder {
    return new FakeQueryBuilder(this, tableName)
  }
}

class FakeQueryBuilder {
  private readonly filters: Array<(row: FakeRow) => boolean> = []
  private insertRows: FakeRow[] | null = null
  private updateValues: FakeRow | null = null
  private orderColumn: string | null = null
  private orderAscending = true
  private limitCount: number | null = null

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly tableName: FakeTableName
  ) {}

  select(): FakeQueryBuilder {
    return this
  }

  insert(value: FakeRow | FakeRow[]): FakeQueryBuilder {
    this.insertRows = Array.isArray(value) ? value : [value]
    return this
  }

  update(value: FakeRow): FakeQueryBuilder {
    this.updateValues = value
    return this
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => row[column] === value)
    return this
  }

  is(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push((row: FakeRow) => row[column] === value)
    return this
  }

  order(
    column: string,
    options: { ascending?: boolean } = {}
  ): FakeQueryBuilder {
    this.orderColumn = column
    this.orderAscending = options.ascending ?? true
    return this
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count
    return this
  }

  async single(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length !== 1) {
      return { data: null, error: new Error("Expected one row.") }
    }

    return { data: rows[0], error: null }
  }

  async maybeSingle(): Promise<{ data: FakeRow | null; error: Error | null }> {
    const rows = this.execute()

    if (rows.length > 1) {
      return { data: null, error: new Error("Expected zero or one row.") }
    }

    return { data: rows[0] ?? null, error: null }
  }

  then<TResult1 = { data: FakeRow[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.execute(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }

  private execute(): FakeRow[] {
    if (this.insertRows) {
      const insertedRows = this.insertRows.map((row: FakeRow) =>
        this.withTimestamps(row)
      )
      this.client.tables[this.tableName].push(...insertedRows)
      return insertedRows
    }

    const matchingRows = this.applyFilters()

    if (this.updateValues) {
      matchingRows.forEach((row: FakeRow) => {
        Object.assign(row, this.updateValues, {
          updated_at: "2026-07-09T12:00:00.000Z",
        })
      })
      return matchingRows
    }

    return matchingRows
  }

  private applyFilters(): FakeRow[] {
    let rows = this.client.tables[this.tableName].filter((row: FakeRow) =>
      this.filters.every((filter: (row: FakeRow) => boolean) => filter(row))
    )

    if (this.orderColumn) {
      rows = [...rows].sort((left: FakeRow, right: FakeRow) => {
        const leftValue = String(left[this.orderColumn ?? ""])
        const rightValue = String(right[this.orderColumn ?? ""])
        return this.orderAscending
          ? leftValue.localeCompare(rightValue)
          : rightValue.localeCompare(leftValue)
      })
    }

    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount)
    }

    return rows
  }

  private withTimestamps(row: FakeRow): FakeRow {
    return {
      created_at: "2026-07-09T12:00:00.000Z",
      updated_at: "2026-07-09T12:00:00.000Z",
      ...row,
    }
  }
}

function createMembershipRow(role: OrganizationRole): FakeRow {
  return {
    id: `membership-${role}`,
    org_id: "org-1",
    user_id: "user-1",
    role,
    status: "active",
    created_at: "2026-07-09T11:00:00.000Z",
    updated_at: "2026-07-09T11:00:00.000Z",
  }
}

function createDeps(
  client: FakeSupabaseClient,
  ids: string[] = []
): DocumentServiceDeps {
  const idQueue = [...ids]

  return {
    client: client as never,
    createId: () => idQueue.shift() ?? "generated-id",
    now: () => "2026-07-09T12:00:00.000Z",
    recordAuditLog: vi.fn().mockResolvedValue(undefined),
    validateDocumentUploadRequest: vi.fn(),
    buildDocumentObjectKey: vi.fn(
      (input: { organizationId: string; documentId: string; versionId: string }) =>
        `organizations/${input.organizationId}/documents/${input.documentId}/versions/${input.versionId}/original.pdf`
    ),
    createSignedDocumentUploadUrl: vi.fn(
      async (input: { organizationId: string; documentId: string; versionId: string }) => ({
        uploadUrl: "https://r2.example/upload",
        storageKey: `organizations/${input.organizationId}/documents/${input.documentId}/versions/${input.versionId}/original.pdf`,
        expiresInSeconds: 900,
      })
    ),
    createSignedDocumentDownloadUrl: vi.fn().mockResolvedValue({
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 900,
    }),
  }
}

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

describe("document upload lifecycle", () => {
  it("rejects invalid uploads before creating document rows", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
    })
    const deps = createDeps(client, ["document-1", "version-1"])
    deps.validateDocumentUploadRequest = vi.fn(() => {
      throw new DocumentServiceError("Document content type is not allowed.", 400)
    })

    await expect(
      createDocumentUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          folderId: null,
          title: "Signed contract",
          description: null,
          originalFilename: "contract.exe",
          contentType: "application/x-msdownload",
          byteSize: 1024,
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Document content type is not allowed.",
      statusCode: 400,
    })

    expect(client.tables.documents).toHaveLength(0)
    expect(client.tables.document_versions).toHaveLength(0)
  })

  it("creates a document with an upload-pending version before returning a signed URL", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
    })
    const deps = createDeps(client, ["document-1", "version-1"])

    const result = await createDocumentUploadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        folderId: null,
        title: "Signed contract",
        description: "Counter-signed PDF",
        originalFilename: "contract.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
      },
      deps
    )

    expect(result).toEqual({
      documentId: "document-1",
      versionId: "version-1",
      uploadUrl: "https://r2.example/upload",
      storageKey:
        "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
      expiresInSeconds: 900,
    })
    expect(client.tables.documents).toMatchObject([
      {
        id: "document-1",
        org_id: "org-1",
        title: "Signed contract",
        description: "Counter-signed PDF",
        current_version_id: null,
        created_by: "user-1",
      },
    ])
    expect(client.tables.document_versions).toMatchObject([
      {
        id: "version-1",
        document_id: "document-1",
        org_id: "org-1",
        version_number: 1,
        status: "upload_pending",
        original_filename: "contract.pdf",
        content_type: "application/pdf",
        byte_size: 1024,
      },
    ])
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "document.created", targetId: "document-1" })
    )
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document_version.created",
        targetId: "version-1",
      })
    )
  })

  it("marks an upload as available and points the document at the current version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [
        {
          id: "document-1",
          org_id: "org-1",
          folder_id: null,
          title: "Signed contract",
          description: null,
          current_version_id: null,
          created_by: "user-1",
          updated_by: "user-1",
          archived_by: null,
          archived_at: null,
          created_at: "2026-07-09T11:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
      ],
      document_versions: [
        {
          id: "version-1",
          org_id: "org-1",
          document_id: "document-1",
          version_number: 1,
          status: "upload_pending",
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
          original_filename: "contract.pdf",
          content_type: "application/pdf",
          byte_size: 1024,
          checksum_sha256: null,
          uploaded_by: "user-1",
          created_at: "2026-07-09T11:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
      ],
    })
    const deps = createDeps(client)

    const version = await completeDocumentUpload(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        versionId: "version-1",
      },
      deps
    )

    expect(version.status).toBe("available")
    expect(client.tables.documents[0]).toMatchObject({
      current_version_id: "version-1",
      updated_by: "user-1",
    })
  })
})

describe("document archive and download lifecycle", () => {
  it("archives documents without deleting rows", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      documents: [
        {
          id: "document-1",
          org_id: "org-1",
          folder_id: null,
          title: "Signed contract",
          description: null,
          current_version_id: "version-1",
          created_by: "user-1",
          updated_by: "user-1",
          archived_by: null,
          archived_at: null,
          created_at: "2026-07-09T11:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
      ],
    })
    const deps = createDeps(client)

    const document = await archiveDocument(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
      },
      deps
    )

    expect(document.archivedAt).toBe("2026-07-09T12:00:00.000Z")
    expect(client.tables.documents).toHaveLength(1)
    expect(client.tables.documents[0]).toMatchObject({
      archived_by: "user-1",
      archived_at: "2026-07-09T12:00:00.000Z",
    })
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.archived",
        targetId: "document-1",
      })
    )
  })

  it("signs downloads only for available current versions", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("external_reviewer")],
      documents: [
        {
          id: "document-1",
          org_id: "org-1",
          folder_id: null,
          title: "Signed contract",
          description: null,
          current_version_id: "version-1",
          created_by: "user-1",
          updated_by: "user-1",
          archived_by: null,
          archived_at: null,
          created_at: "2026-07-09T11:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
      ],
      document_versions: [
        {
          id: "version-1",
          org_id: "org-1",
          document_id: "document-1",
          version_number: 1,
          status: "available",
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
          original_filename: "contract.pdf",
          content_type: "application/pdf",
          byte_size: 1024,
          checksum_sha256: null,
          uploaded_by: "user-1",
          created_at: "2026-07-09T11:00:00.000Z",
          updated_at: "2026-07-09T11:00:00.000Z",
        },
      ],
    })
    const deps = createDeps(client)

    const result = await createDocumentDownloadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
      },
      deps
    )

    expect(result).toEqual({
      documentId: "document-1",
      versionId: "version-1",
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 900,
    })
    expect(deps.createSignedDocumentDownloadUrl).toHaveBeenCalledWith({
      storageKey:
        "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
    })
  })
})
