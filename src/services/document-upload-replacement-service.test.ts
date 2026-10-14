import { afterEach, describe, expect, it, vi } from "vitest"

import { DocumentStorageServiceError } from "@/services/document-storage-service"
import {
  completeDocumentUpload,
  createDocumentReplacementUploadUrl,
  createDocumentUploadUrl,
  discardPendingDocumentUpload,
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

describe("document upload lifecycle", () => {
  it("rejects invalid uploads before creating document rows", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
    })
    const deps = createDeps(client, ["document-1", "version-1"])
    deps.validateDocumentUploadRequest = vi.fn(() => {
      throw new DocumentStorageServiceError(
        "Document content type is not allowed.",
        400
      )
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

  it("checks the title before it signs anything, and leaves no document behind when its version cannot be stored", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
    })
    const deps = createDeps(client, ["document-1", "version-1", "document-2", "version-2"])
    const upload = {
      actorUserId: "user-1",
      organizationId: "org-1",
      folderId: null,
      title: "   ",
      description: null,
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    }

    await expect(createDocumentUploadUrl(upload, deps)).rejects.toMatchObject({ statusCode: 400 })
    expect(deps.createSignedDocumentUploadUrl).not.toHaveBeenCalled()

    client.failNextWrites("document_versions", "23514")

    await expect(createDocumentUploadUrl({ ...upload, title: "Signed contract" }, deps)).rejects.toMatchObject({ statusCode: 500 })
    expect(client.tables.documents).toHaveLength(0)
    expect(client.tables.document_versions).toHaveLength(0)
  })

  it("does not persist document rows when upload URL signing fails", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
    })
    const deps = createDeps(client, ["document-1", "version-1"])
    deps.createSignedDocumentUploadUrl = vi.fn().mockRejectedValue(
      new DocumentStorageServiceError(
        "Unable to create signed document upload URL.",
        500
      )
    )

    await expect(
      createDocumentUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          title: "Signed contract",
          originalFilename: "contract.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Unable to create signed document upload URL.",
      statusCode: 500,
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
        upload_authorization_expires_at: "2026-07-09T12:15:00.000Z",
      },
    ])
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document.created",
        targetId: "document-1",
      })
    )
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document_version.created",
        targetId: "version-1",
      })
    )
  })

  it("creates the next replacement version without changing the current version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ current_version_id: "version-1" })],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client, ["version-2"])
    const rpcSpy = vi.spyOn(client, "rpc")

    const result = await createDocumentReplacementUploadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        originalFilename: "contract-revised.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      deps
    )

    expect(result).toMatchObject({
      documentId: "document-1",
      versionId: "version-2",
      uploadUrl: "https://r2.example/upload",
    })
    expect(client.tables.documents[0]?.current_version_id).toBe("version-1")
    expect(client.tables.document_versions).toHaveLength(2)
    expect(client.tables.document_versions[1]).toMatchObject({
      id: "version-2",
      document_id: "document-1",
      version_number: 2,
      status: "upload_pending",
      original_filename: "contract-revised.pdf",
      byte_size: 2048,
      upload_authorization_expires_at: "2026-07-09T12:15:00.000Z",
    })
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual([
      "get_document_access_level",
      "create_pending_document_version",
      "register_document_version_upload_authorization",
    ])
    expect(rpcSpy).toHaveBeenCalledWith(
      "create_pending_document_version",
      expect.objectContaining({
        target_upload_authorization_expires_at:
          "2026-07-09T12:15:00.000Z",
      })
    )
    expect(rpcSpy).toHaveBeenLastCalledWith(
      "register_document_version_upload_authorization",
      {
        target_org_id: "org-1",
        target_document_id: "document-1",
        target_version_id: "version-2",
        target_uploaded_by: "user-1",
        target_expires_at: "2026-07-09T12:15:00.000Z",
      }
    )
    expect(deps.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "document_version.created",
        targetId: "version-2",
        metadata: expect.objectContaining({
          documentId: "document-1",
          versionNumber: 2,
        }),
      })
    )
  })

  it("refreshes upload access for the same pending replacement version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow(),
        createVersionRow({
          id: "version-2",
          version_number: 2,
          status: "upload_pending",
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
          original_filename: "contract-revised.pdf",
          byte_size: 2048,
          upload_authorization_expires_at: "2026-07-09T12:05:00.000Z",
        }),
      ],
    })
    const deps = createDeps(client)
    deps.createId = vi.fn(() => "unexpected-version")
    const rpcSpy = vi.spyOn(client, "rpc")

    const result = await createDocumentReplacementUploadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        pendingVersionId: "version-2",
        originalFilename: "contract-revised.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      deps
    )

    expect(result).toMatchObject({
      documentId: "document-1",
      versionId: "version-2",
      uploadUrl: "https://r2.example/upload",
    })
    expect(deps.createId).not.toHaveBeenCalled()
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual([
      "get_document_access_level",
      "register_document_version_upload_authorization",
    ])
    expect(
      client.tables.document_versions[1]?.upload_authorization_expires_at
    ).toBe("2026-07-09T12:15:00.000Z")
    expect(client.tables.document_versions).toHaveLength(2)
  })

  it("preserves the greatest expiry across signed URL refreshes", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow({
          status: "upload_pending",
          upload_authorization_expires_at: "2026-07-09T12:30:00.000Z",
        }),
      ],
    })

    await createDocumentReplacementUploadUrl(
      {
        actorUserId: "user-1",
        organizationId: "org-1",
        documentId: "document-1",
        pendingVersionId: "version-1",
        originalFilename: "contract.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
      },
      createDeps(client)
    )

    expect(
      client.tables.document_versions[0]?.upload_authorization_expires_at
    ).toBe("2026-07-09T12:30:00.000Z")
  })

  it("does not expose a refreshed signed URL when the document leaves active lifecycle before authorization registration", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow({
          id: "version-2",
          version_number: 2,
          status: "upload_pending",
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
        }),
      ],
    })
    const deps = createDeps(client)
    deps.createSignedDocumentUploadUrl = vi.fn(async () => {
      const document = client.tables.documents[0]

      if (!document) {
        throw new Error("Expected document fixture.")
      }

      document.lifecycle_state = "trashed"

      return {
        uploadUrl: "https://r2.example/replayed-upload",
        storageKey:
          "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
        expiresInSeconds: 900,
        expiresAt: "2026-07-09T12:15:00.000Z",
      }
    })

    await expect(
      createDocumentReplacementUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          pendingVersionId: "version-2",
          originalFilename: "contract.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Unable to authorize replacement upload.",
      statusCode: 409,
    })

    expect(
      client.tables.document_versions[0]?.upload_authorization_expires_at
    ).toBeNull()
  })

  it("rejects a pending-version refresh for different file metadata", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow({
          id: "version-2",
          version_number: 2,
          status: "upload_pending",
          original_filename: "contract-revised.pdf",
          byte_size: 2048,
        }),
      ],
    })
    const deps = createDeps(client)

    await expect(
      createDocumentReplacementUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          pendingVersionId: "version-2",
          originalFilename: "different.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Pending version metadata does not match the replacement file.",
      statusCode: 409,
    })
  })

  it("rejects refreshing another member's pending replacement", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow({
          id: "version-2",
          version_number: 2,
          status: "upload_pending",
          uploaded_by: "user-2",
        }),
      ],
    })
    const deps = createDeps(client)

    await expect(
      createDocumentReplacementUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          pendingVersionId: "version-2",
          originalFilename: "contract.pdf",
          contentType: "application/pdf",
          byteSize: 1024,
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "You can only resume your own pending document version.",
      statusCode: 403,
    })

    expect(deps.createSignedDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it("never puts an uploaded file in place of a generated or signed document", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ source_kind: "generated" })],
      document_versions: [createVersionRow(), createVersionRow({ id: "version-2", status: "upload_pending", version_number: 2 })],
    })
    const deps = createDeps(client, ["version-3"])
    const actor = { actorUserId: "user-1", organizationId: "org-1", documentId: "document-1" }

    await expect(
      createDocumentReplacementUploadUrl(
        { ...actor, originalFilename: "forged.pdf", contentType: "application/pdf", byteSize: 2048 },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 409 })
    await expect(completeDocumentUpload({ ...actor, versionId: "version-2" }, deps)).rejects.toMatchObject({ statusCode: 409 })

    expect(client.tables.document_versions).toHaveLength(2)
    expect(client.tables.document_versions[1].status).toBe("upload_pending")
    expect(client.tables.documents[0].current_version_id).toBe("version-1")
  })

  it.each([
    ["an archived document", 409, {}, { archived_at: "2026-07-09T11:30:00.000Z" }],
    ["a failed upload signature", 500, { failSigning: true }, {}],
  ])("allocates no replacement version for %s", async (_case, statusCode, { failSigning }: { failSigning?: boolean }, document) => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ current_version_id: "version-1", ...document })],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client, ["version-2"])
    if (failSigning) {
      deps.createSignedDocumentUploadUrl = vi.fn().mockRejectedValue(
        new DocumentStorageServiceError("Unable to create signed document upload URL.", 500)
      )
    }

    await expect(
      createDocumentReplacementUploadUrl(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          originalFilename: "contract-revised.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        },
        deps
      )
    ).rejects.toMatchObject({ statusCode })

    expect(client.tables.document_versions).toHaveLength(1)
  })

  it("marks an upload as available and points the document at the current version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ current_version_id: null })],
      document_versions: [createVersionRow({ status: "upload_pending" })],
    })
    const deps = createDeps(client)
    deps.verifyDocumentUpload = vi.fn().mockResolvedValue("a".repeat(64))

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
    expect(client.tables.document_versions[0].checksum_sha256).toBe("a".repeat(64))
    expect(client.tables.documents[0]).toMatchObject({
      current_version_id: "version-1",
      updated_by: "user-1",
    })
  })

  it("returns an already available version when completion is retried", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client)
    const rpcSpy = vi.spyOn(client, "rpc")

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
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual([
      "get_document_access_level",
    ])
  })

  it("completes concurrent retries without duplicating version activity", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ current_version_id: null })],
      document_versions: [createVersionRow({ status: "upload_pending" })],
    })
    const deps = createDeps(client)

    const versions = await Promise.all([
      completeDocumentUpload(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          versionId: "version-1",
        },
        deps
      ),
      completeDocumentUpload(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          versionId: "version-1",
        },
        deps
      ),
    ])

    expect(versions.map((version) => version.status)).toEqual([
      "available",
      "available",
    ])
    expect(client.tables.document_activity_events).toHaveLength(1)
  })

  it.each([
    ["its object is missing", "Uploaded document object was not found."],
    ["its metadata mismatches", "Uploaded document byte size does not match the pending version."],
  ])("keeps a pending replacement out of current state when %s", async (_case, reason) => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [
        createVersionRow(),
        createVersionRow({
          id: "version-2",
          version_number: 2,
          status: "upload_pending",
          storage_key:
            "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
        }),
      ],
    })
    const deps = createDeps(client)
    deps.verifyDocumentUpload = vi.fn().mockRejectedValue(new DocumentStorageServiceError(reason, 409))
    const rpcSpy = vi.spyOn(client, "rpc")

    await expect(
      completeDocumentUpload(
        { actorUserId: "user-1", organizationId: "org-1", documentId: "document-1", versionId: "version-2" },
        deps
      )
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(client.tables.documents[0]?.current_version_id).toBe("version-1")
    expect(client.tables.document_versions[1]?.status).toBe("upload_pending")
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual(["get_document_access_level"])
  })

  it("takes back the uploader's own upload that never completed, and nothing else", async () => {
    const pendingKey = "organizations/org-1/documents/document-2/versions/version-2/original.pdf"
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [
        createDocumentRow(),
        createDocumentRow({ id: "document-2", current_version_id: null }),
        createDocumentRow({ id: "document-3", current_version_id: null, created_by: "user-2" }),
        // A document made in BizFlow has no version either, and must never go this way.
        createDocumentRow({ id: "document-4", current_version_id: null, source_kind: "generated" }),
      ],
      document_versions: [
        createVersionRow(),
        createVersionRow({ id: "version-2", document_id: "document-2", status: "upload_pending", storage_key: pendingKey }),
      ],
    })
    const deps = { ...createDeps(client), deleteDocumentStorageObject: vi.fn(async () => undefined) }
    const discard = (documentId: string, organizationId = "org-1") =>
      discardPendingDocumentUpload({ actorUserId: "user-1", organizationId, documentId }, deps)
    const ids = (): unknown[] => client.tables.documents.map((row) => row.id)

    // An upload that completed, someone else's, and one in another workspace stay.
    await expect(discard("document-1")).rejects.toMatchObject({ statusCode: 404 })
    await expect(discard("document-3")).rejects.toMatchObject({ statusCode: 404 })
    await expect(discard("document-4")).rejects.toMatchObject({ statusCode: 404 })
    await expect(discard("document-2", "org-2")).rejects.toMatchObject({ statusCode: 403 })
    expect(ids()).toEqual(["document-1", "document-2", "document-3", "document-4"])

    await discard("document-2")

    expect(ids()).toEqual(["document-1", "document-3", "document-4"])
    // Whatever bytes reached storage before the upload stopped go with it.
    expect(deps.deleteDocumentStorageObject).toHaveBeenCalledWith({ storageKey: pendingKey })
  })
})
