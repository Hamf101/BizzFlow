import { afterEach, describe, expect, it, vi } from "vitest"

import {
  archiveDocument,
  createDocumentDownloadUrl,
} from "@/services/document-service"
import {
  createDeps,
  createDocumentRow,
  createMembershipRow,
  createVersionRow,
  FakeSupabaseClient,
} from "@/services/document-service.test-support"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
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
    expect(client.tables.document_activity_events).toEqual([
      expect.objectContaining({
        org_id: "org-1",
        document_id: "document-1",
        actor_user_id: "user-1",
        event_type: "document.archived",
      }),
    ])
  })

  it("serializes concurrent archive requests without duplicate activity", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("manager")],
      documents: [createDocumentRow({ archived_at: null })],
    })
    const deps = createDeps(client)
    const input = {
      actorUserId: "user-1",
      organizationId: "org-1",
      documentId: "document-1",
    }

    const results = await Promise.allSettled([
      archiveDocument(input, deps),
      archiveDocument(input, deps),
    ])

    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ statusCode: 409 }),
      }),
    ])
    expect(client.tables.document_activity_events).toHaveLength(1)
  })

  it.each([
    {
      code: "42501",
      databaseMessage: "Contributor access and a manager role are required.",
      expectedStatusCode: 403,
    },
    {
      code: "P0001",
      databaseMessage: "Only active documents may be archived.",
      expectedStatusCode: 409,
    },
  ])(
    "maps archive RPC $code races to a stable client error",
    async ({ code, databaseMessage, expectedStatusCode }) => {
      const client = new FakeSupabaseClient({
        organization_memberships: [createMembershipRow("manager")],
        documents: [createDocumentRow()],
      })
      const originalRpc = client.rpc.bind(client)

      vi.spyOn(client, "rpc").mockImplementation(
        async (functionName, args) => {
          if (functionName === "archive_document") {
            return {
              data: null,
              error: Object.assign(new Error(databaseMessage), { code }),
            }
          }

          return originalRpc(functionName, args)
        }
      )

      await expect(
        archiveDocument(
          {
            actorUserId: "user-1",
            organizationId: "org-1",
            documentId: "document-1",
          },
          createDeps(client)
        )
      ).rejects.toMatchObject({ statusCode: expectedStatusCode })
    }
  )

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
    expect(deps.recordAuditLog).toHaveBeenCalledWith({
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "document_version.download_url_issued",
      targetType: "document_version",
      targetId: "version-1",
      metadata: {
        documentId: "document-1",
        versionId: "version-1",
        versionNumber: 1,
        originalFilename: "contract.pdf",
      },
    })
  })

  it("signs a requested historical version instead of the current version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("external_reviewer")],
      documents: [createDocumentRow({ current_version_id: "version-2" })],
      document_versions: [
        createVersionRow(),
        createVersionRow({
          id: "version-2",
          version_number: 2,
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
          original_filename: "contract-revised.pdf",
        }),
      ],
    })
    const deps = createDeps(client)

    const result = await createDocumentDownloadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        versionId: "version-1",
      },
      deps
    )

    expect(result.versionId).toBe("version-1")
    expect(deps.createSignedDocumentDownloadUrl).toHaveBeenCalledWith({
      storageKey:
        "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
    })
  })

  it("does not return a signed URL when the required download audit fails", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client)
    deps.recordAuditLog = vi
      .fn()
      .mockRejectedValue(new Error("Audit unavailable"))
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      createDocumentDownloadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Unable to record the document download audit event.",
      statusCode: 500,
    })
  })
})
