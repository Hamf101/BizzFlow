import { afterEach, describe, expect, it, vi } from "vitest"

import { DocumentStorageServiceError } from "@/services/document-storage-service"
import {
  completeDocumentUpload,
  createDocumentReplacementUploadUrl,
  createDocumentUploadUrl,
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
    })
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
    ])
    expect(client.tables.document_versions).toHaveLength(2)
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

  it("rejects replacements for archived documents", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [
        createDocumentRow({
          current_version_id: "version-1",
          archived_at: "2026-07-09T11:30:00.000Z",
        }),
      ],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client, ["version-2"])

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
    ).rejects.toMatchObject({
      message: "Only active documents can be replaced.",
      statusCode: 409,
    })

    expect(client.tables.document_versions).toHaveLength(1)
  })

  it("does not allocate a replacement version when upload URL signing fails", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow()],
      document_versions: [createVersionRow()],
    })
    const deps = createDeps(client, ["version-2"])
    deps.createSignedDocumentUploadUrl = vi.fn().mockRejectedValue(
      new DocumentStorageServiceError(
        "Unable to create signed document upload URL.",
        500
      )
    )

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
    ).rejects.toMatchObject({
      message: "Unable to create signed document upload URL.",
      statusCode: 500,
    })

    expect(client.tables.document_versions).toHaveLength(1)
  })

  it("marks an upload as available and points the document at the current version", async () => {
    const client = new FakeSupabaseClient({
      organization_memberships: [createMembershipRow("staff")],
      documents: [createDocumentRow({ current_version_id: null })],
      document_versions: [createVersionRow({ status: "upload_pending" })],
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

  it("keeps a pending replacement out of current state when its object is missing", async () => {
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
    deps.verifyDocumentUpload = vi.fn().mockRejectedValue(
      new DocumentStorageServiceError(
        "Uploaded document object was not found.",
        409
      )
    )
    const rpcSpy = vi.spyOn(client, "rpc")

    await expect(
      completeDocumentUpload(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          versionId: "version-2",
        },
        deps
      )
    ).rejects.toMatchObject({
      message: "Uploaded document object was not found.",
      statusCode: 409,
    })

    expect(client.tables.documents[0]?.current_version_id).toBe("version-1")
    expect(client.tables.document_versions[1]?.status).toBe("upload_pending")
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual([
      "get_document_access_level",
    ])
  })

  it("keeps a pending replacement out of current state when metadata mismatches", async () => {
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
    deps.verifyDocumentUpload = vi.fn().mockRejectedValue(
      new DocumentStorageServiceError(
        "Uploaded document byte size does not match the pending version.",
        409
      )
    )
    const rpcSpy = vi.spyOn(client, "rpc")

    await expect(
      completeDocumentUpload(
        {
          actorUserId: "user-1",
          organizationId: "org-1",
          documentId: "document-1",
          versionId: "version-2",
        },
        deps
      )
    ).rejects.toMatchObject({
      message:
        "Uploaded document byte size does not match the pending version.",
      statusCode: 409,
    })

    expect(client.tables.documents[0]?.current_version_id).toBe("version-1")
    expect(client.tables.document_versions[1]?.status).toBe("upload_pending")
    expect(rpcSpy.mock.calls.map(([functionName]) => functionName)).toEqual([
      "get_document_access_level",
    ])
  })
})
