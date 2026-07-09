import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  AuthenticationError,
  getAuthenticatedUser,
} from "@/lib/auth"
import {
  completeDocumentUpload,
  createDocumentDownloadUrl,
  createDocumentUploadUrl,
  DocumentServiceError,
} from "@/services/document-service"

import { POST as completeUploadPost } from "./[documentId]/complete-upload/route"
import { GET as downloadUrlGet } from "./[documentId]/download-url/route"
import { POST as uploadUrlPost } from "./upload-url/route"

vi.mock("@/lib/auth", () => {
  class MockAuthenticationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "AuthenticationError"
    }
  }

  return {
    AuthenticationError: MockAuthenticationError,
    getAuthenticatedUser: vi.fn(),
  }
})

vi.mock("@/services/document-service", () => {
  class MockDocumentServiceError extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.name = "DocumentServiceError"
      this.statusCode = statusCode
    }
  }

  return {
    DocumentServiceError: MockDocumentServiceError,
    completeDocumentUpload: vi.fn(),
    createDocumentDownloadUrl: vi.fn(),
    createDocumentUploadUrl: vi.fn(),
  }
})

describe("document API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
    })
  })

  it("maps upload URL service errors to their HTTP status code", async () => {
    vi.mocked(createDocumentUploadUrl).mockRejectedValue(
      new DocumentServiceError("You cannot create documents.", 403)
    )

    const response = await uploadUrlPost(
      jsonRequest("http://localhost/api/documents/upload-url", {
        organizationId: "org-1",
        folderId: null,
        title: "Signed contract",
        description: "Counter-signed PDF",
        originalFilename: "contract.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: "You cannot create documents.",
    })
    expect(response.status).toBe(403)
    expect(createDocumentUploadUrl).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
      folderId: null,
      title: "Signed contract",
      description: "Counter-signed PDF",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    })
  })

  it("passes the path document id when completing uploads", async () => {
    vi.mocked(completeDocumentUpload).mockResolvedValue({
      id: "version-1",
      organizationId: "org-1",
      documentId: "document-1",
      versionNumber: 1,
      status: "available",
      storageKey:
        "organizations/org-1/documents/document-1/versions/version-1/original.pdf",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
      checksumSha256: null,
      uploadedBy: "user-1",
      createdAt: "2026-07-09T12:00:00.000Z",
      updatedAt: "2026-07-09T12:00:00.000Z",
    })

    const response = await completeUploadPost(
      jsonRequest(
        "http://localhost/api/documents/document-1/complete-upload",
        {
          organizationId: "org-1",
          versionId: "version-1",
        }
      ),
      { params: Promise.resolve({ documentId: "document-1" }) }
    )

    await expect(response.json()).resolves.toEqual({
      version: expect.objectContaining({
        id: "version-1",
        status: "available",
      }),
    })
    expect(response.status).toBe(200)
    expect(completeDocumentUpload).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
      documentId: "document-1",
      versionId: "version-1",
    })
  })

  it("returns unauthorized when download URL requests have no valid user", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    const response = await downloadUrlGet(
      new Request(
        "http://localhost/api/documents/document-1/download-url?organizationId=org-1"
      ),
      { params: Promise.resolve({ documentId: "document-1" }) }
    )

    await expect(response.json()).resolves.toEqual({
      error: "Sign in to continue.",
    })
    expect(response.status).toBe(401)
    expect(createDocumentDownloadUrl).not.toHaveBeenCalled()
  })
})

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
