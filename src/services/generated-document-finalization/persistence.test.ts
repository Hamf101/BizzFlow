import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { FinalizeGeneratedDocumentPdfInput } from "@/services/generated-document-finalization/contracts"
import { createSupabaseFinalizationPersistence } from "@/services/generated-document-finalization/persistence"
import { describe, expect, it, vi } from "vitest"

const ACTOR_ID = "10000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const FINALIZATION_ID = "40000000-0000-4000-8000-000000000001"
const VERSION_ID = "50000000-0000-4000-8000-000000000001"
const STORAGE_KEY =
  "organizations/20000000-0000-4000-8000-000000000001/documents/30000000-0000-4000-8000-000000000001/finalizations/40000000-0000-4000-8000-000000000001/final.pdf"
const RENDER_SHA256 = "a".repeat(64)
const PDF_SHA256 = "b".repeat(64)

const input: FinalizeGeneratedDocumentPdfInput = {
  actorUserId: ACTOR_ID,
  organizationId: ORGANIZATION_ID,
  documentId: DOCUMENT_ID,
}

describe("generated document finalization Supabase persistence", () => {
  it("requires an active membership with documents:view permission", async () => {
    const database = createTestDatabase({
      queryResults: {
        organization_memberships: {
          data: {
            id: "60000000-0000-4000-8000-000000000001",
            org_id: ORGANIZATION_ID,
            user_id: ACTOR_ID,
            role: "external_reviewer",
            status: "active",
            created_at: "2026-07-18T07:00:00.000Z",
            updated_at: "2026-07-18T07:00:00.000Z",
          },
          error: null,
        },
        documents: {
          data: {
            lifecycle_state: "active",
            archived_at: null,
          },
          error: null,
        },
      },
      rpcResults: {
        get_document_access_level: {
          data: "viewer",
          error: null,
        },
      },
    })
    const persistence = createSupabaseFinalizationPersistence(database.client)

    await expect(
      persistence.requireViewPermission(input)
    ).resolves.toBeUndefined()
    expect(database.rpc).toHaveBeenCalledWith("get_document_access_level", {
      target_org_id: ORGANIZATION_ID,
      target_document_id: DOCUMENT_ID,
      target_actor_user_id: ACTOR_ID,
    })
    expect(database.queryCalls).toEqual([
      {
        relation: "organization_memberships",
        columns: "id,org_id,user_id,role,status,created_at,updated_at",
        filters: [
          ["org_id", ORGANIZATION_ID],
          ["user_id", ACTOR_ID],
          ["status", "active"],
        ],
      },
      {
        relation: "documents",
        columns: "lifecycle_state,archived_at",
        filters: [
          ["id", DOCUMENT_ID],
          ["org_id", ORGANIZATION_ID],
        ],
      },
    ])
  })

  it("hides finalization state when the actor lacks document access", async () => {
    const database = createTestDatabase({
      rpcResults: {
        get_document_access_level: {
          data: null,
          error: null,
        },
      },
    })
    const persistence = createSupabaseFinalizationPersistence(database.client)

    await expect(
      persistence.requireViewPermission(input)
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })

    expect(database.queryCalls).toEqual([])
  })

  it("hides finalization state for a trashed document", async () => {
    const database = createTestDatabase({
      queryResults: {
        organization_memberships: {
          data: {
            id: "60000000-0000-4000-8000-000000000001",
            org_id: ORGANIZATION_ID,
            user_id: ACTOR_ID,
            role: "manager",
            status: "active",
            created_at: "2026-07-18T07:00:00.000Z",
            updated_at: "2026-07-18T07:00:00.000Z",
          },
          error: null,
        },
        documents: {
          data: {
            lifecycle_state: "trashed",
            archived_at: null,
          },
          error: null,
        },
      },
      rpcResults: {
        get_document_access_level: {
          data: "contributor",
          error: null,
        },
      },
    })
    const persistence = createSupabaseFinalizationPersistence(database.client)

    await expect(
      persistence.requireViewPermission(input)
    ).rejects.toMatchObject({
      message: "Document was not found.",
      statusCode: 404,
    })
  })

  it("loads and maps one tenant-scoped finalized row", async () => {
    const database = createTestDatabase({
      queryResults: {
        generated_document_finalizations: {
          data: createFinalizationRow({
            status: "finalized",
            pdf_sha256: PDF_SHA256,
            byte_size: 2_048,
            document_version_id: VERSION_ID,
          }),
          error: null,
        },
      },
    })
    const persistence = createSupabaseFinalizationPersistence(database.client)

    await expect(
      persistence.findByDocument(ORGANIZATION_ID, DOCUMENT_ID)
    ).resolves.toEqual({
      id: FINALIZATION_ID,
      status: "finalized",
      storageKey: STORAGE_KEY,
      renderInputSha256: RENDER_SHA256,
      pdfSha256: PDF_SHA256,
      byteSize: 2_048,
      documentVersionId: VERSION_ID,
      createdAt: "2026-07-18T07:08:09.000Z",
    })
    expect(database.queryCalls).toEqual([
      {
        relation: "generated_document_finalizations",
        columns:
          "id,status,storage_key,render_input_sha256,pdf_sha256,byte_size,document_version_id,created_at",
        filters: [
          ["org_id", ORGANIZATION_ID],
          ["document_id", DOCUMENT_ID],
        ],
      },
    ])
  })

  it("sends exact prepare and promote RPC arguments and parses their results", async () => {
    const database = createTestDatabase({
      rpcResults: {
        prepare_generated_document_finalization: {
          data: [createFinalizationRow()],
          error: null,
        },
        promote_generated_document_finalization: {
          data: VERSION_ID,
          error: null,
        },
      },
    })
    const persistence = createSupabaseFinalizationPersistence(database.client)

    await expect(
      persistence.prepare({
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        finalizationId: FINALIZATION_ID,
        storageKey: STORAGE_KEY,
        renderInputSha256: RENDER_SHA256,
        createdBy: ACTOR_ID,
      })
    ).resolves.toEqual({
      id: FINALIZATION_ID,
      status: "pending",
      storageKey: STORAGE_KEY,
      renderInputSha256: RENDER_SHA256,
      pdfSha256: null,
      byteSize: null,
      documentVersionId: null,
      createdAt: "2026-07-18T07:08:09.000Z",
    })
    await expect(
      persistence.promote({
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        finalizationId: FINALIZATION_ID,
        pdfSha256: PDF_SHA256,
        byteSize: 2_048,
        originalFilename: "agreement-final.pdf",
        finalizedBy: ACTOR_ID,
      })
    ).resolves.toBe(VERSION_ID)

    expect(database.rpc).toHaveBeenNthCalledWith(
      1,
      "prepare_generated_document_finalization",
      {
        target_org_id: ORGANIZATION_ID,
        target_document_id: DOCUMENT_ID,
        target_finalization_id: FINALIZATION_ID,
        target_storage_key: STORAGE_KEY,
        target_render_input_sha256: RENDER_SHA256,
        target_created_by: ACTOR_ID,
      }
    )
    expect(database.rpc).toHaveBeenNthCalledWith(
      2,
      "promote_generated_document_finalization",
      {
        target_org_id: ORGANIZATION_ID,
        target_document_id: DOCUMENT_ID,
        target_finalization_id: FINALIZATION_ID,
        target_pdf_sha256: PDF_SHA256,
        target_byte_size: 2_048,
        target_original_filename: "agreement-final.pdf",
        target_finalized_by: ACTOR_ID,
      }
    )
  })

  it.each([
    ["P0002", "Generated document was not found.", 404],
    [
      "23514",
      "Generated document finalization conflicted with persisted state.",
      409,
    ],
    [
      "22023",
      "Generated document finalization input is invalid.",
      400,
    ],
    ["XX000", "Unable to prepare generated document finalization.", 500],
  ])(
    "maps %s prepare failures to a safe service error",
    async (code: string, message: string, statusCode: number) => {
      const database = createTestDatabase({
        rpcResults: {
          prepare_generated_document_finalization: {
            data: null,
            error: {
              code,
              message: "secret database provider detail",
            },
          },
        },
      })
      const persistence = createSupabaseFinalizationPersistence(
        database.client
      )

      await expect(
        persistence.prepare({
          organizationId: ORGANIZATION_ID,
          documentId: DOCUMENT_ID,
          finalizationId: FINALIZATION_ID,
          storageKey: STORAGE_KEY,
          renderInputSha256: RENDER_SHA256,
          createdBy: ACTOR_ID,
        })
      ).rejects.toMatchObject({ message, statusCode })
    }
  )
})

type DatabaseResult = {
  data: unknown
  error: { code?: string; message?: string } | null
}

type QueryCall = {
  relation: string
  columns?: string
  filters: Array<[string, string]>
}

type TestDatabase = {
  client: AdminSupabaseClient
  queryCalls: QueryCall[]
  rpc: ReturnType<typeof vi.fn>
}

type TestQuery = {
  select: (columns: string) => TestQuery
  eq: (column: string, value: string) => TestQuery
  maybeSingle: () => Promise<DatabaseResult>
}

function createTestDatabase(options: {
  queryResults?: Record<string, DatabaseResult>
  rpcResults?: Record<string, DatabaseResult>
}): TestDatabase {
  const queryCalls: QueryCall[] = []
  const from = vi.fn((relation: string) => {
    const queryCall: QueryCall = {
      relation,
      filters: [],
    }
    const query: TestQuery = {
      select: (columns: string): TestQuery => {
        queryCall.columns = columns
        return query
      },
      eq: (column: string, value: string): TestQuery => {
        queryCall.filters.push([column, value])
        return query
      },
      maybeSingle: async (): Promise<DatabaseResult> => {
        queryCalls.push(queryCall)
        return (
          options.queryResults?.[relation] ?? { data: null, error: null }
        )
      },
    }

    return query
  })
  const rpc = vi.fn(
    async (functionName: string): Promise<DatabaseResult> =>
      options.rpcResults?.[functionName] ?? { data: null, error: null }
  )

  return {
    client: { from, rpc } as unknown as AdminSupabaseClient,
    queryCalls,
    rpc,
  }
}

function createFinalizationRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: FINALIZATION_ID,
    status: "pending",
    storage_key: STORAGE_KEY,
    render_input_sha256: RENDER_SHA256,
    pdf_sha256: null,
    byte_size: null,
    document_version_id: null,
    created_at: "2026-07-18T07:08:09.987Z",
    ...overrides,
  }
}
