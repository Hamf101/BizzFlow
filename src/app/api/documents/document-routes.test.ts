import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  AuthenticationError,
  getAuthenticatedUser,
} from "@/lib/auth"
import {
  completeDocumentUpload,
  createDocumentDownloadUrl,
  createDocumentReplacementUploadUrl,
  createDocumentUploadUrl,
  DocumentServiceError,
} from "@/services/document-service"

import { POST as completeUploadPost } from "./[documentId]/complete-upload/route"
import { POST as downloadUrlPost } from "./[documentId]/download-url/route"
import { POST as replaceUploadUrlPost } from "./[documentId]/replace-upload-url/route"
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
    createDocumentReplacementUploadUrl: vi.fn(),
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

  it("rejects cross-origin JSON mutation requests before calling services", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost"
    const response = await uploadUrlPost(
      jsonRequest(
        "http://localhost/api/documents/upload-url",
        { organizationId: "org-1" },
        { origin: "https://attacker.example.net" }
      )
    )

    await expect(response.json()).resolves.toEqual({
      error: "Cross-origin requests are not allowed.",
    })
    expect(response.status).toBe(403)
    expect(createDocumentUploadUrl).not.toHaveBeenCalled()
  })

  it("rejects simple text request bodies", async () => {
    const response = await uploadUrlPost(
      new Request("http://localhost/api/documents/upload-url", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ organizationId: "org-1" }),
      })
    )

    await expect(response.json()).resolves.toEqual({
      error: "Content-Type must be application/json.",
    })
    expect(response.status).toBe(415)
    expect(createDocumentUploadUrl).not.toHaveBeenCalled()
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

  it("passes replacement file metadata with the path document id", async () => {
    vi.mocked(createDocumentReplacementUploadUrl).mockResolvedValue({
      documentId: "document-1",
      versionId: "version-2",
      uploadUrl: "https://r2.example/upload",
      storageKey:
        "organizations/org-1/documents/document-1/versions/version-2/original.pdf",
      expiresInSeconds: 900,
    })

    const response = await replaceUploadUrlPost(
      jsonRequest(
        "http://localhost/api/documents/document-1/replace-upload-url",
        {
          organizationId: "org-1",
          pendingVersionId: "version-2",
          originalFilename: "contract-revised.pdf",
          contentType: "application/pdf",
          byteSize: 2048,
        }
      ),
      { params: Promise.resolve({ documentId: "document-1" }) }
    )

    expect(response.status).toBe(201)
    expect(createDocumentReplacementUploadUrl).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
      documentId: "document-1",
      pendingVersionId: "version-2",
      originalFilename: "contract-revised.pdf",
      contentType: "application/pdf",
      byteSize: 2048,
    })
  })

  it.each([null, "", "   ", 42])(
    "rejects an invalid present pending version id (%s)",
    async (pendingVersionId: unknown) => {
      const response = await replaceUploadUrlPost(
        jsonRequest(
          "http://localhost/api/documents/document-1/replace-upload-url",
          {
            organizationId: "org-1",
            pendingVersionId,
            originalFilename: "contract-revised.pdf",
            contentType: "application/pdf",
            byteSize: 2048,
          }
        ),
        { params: Promise.resolve({ documentId: "document-1" }) }
      )

      await expect(response.json()).resolves.toEqual({
        error: "Pending version id is required.",
      })
      expect(response.status).toBe(400)
      expect(createDocumentReplacementUploadUrl).not.toHaveBeenCalled()
    }
  )

  it("returns unauthorized when download URL requests have no valid user", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    const response = await downloadUrlPost(
      jsonRequest(
        "http://localhost/api/documents/document-1/download-url",
        { organizationId: "org-1" }
      ),
      { params: Promise.resolve({ documentId: "document-1" }) }
    )

    await expect(response.json()).resolves.toEqual({
      error: "Sign in to continue.",
    })
    expect(response.status).toBe(401)
    expect(createDocumentDownloadUrl).not.toHaveBeenCalled()
  })

  it("passes an optional historical version id to the download service", async () => {
    vi.mocked(createDocumentDownloadUrl).mockResolvedValue({
      documentId: "document-1",
      versionId: "version-1",
      downloadUrl: "https://r2.example/download",
      expiresInSeconds: 900,
    })

    const response = await downloadUrlPost(
      jsonRequest(
        "http://localhost/api/documents/document-1/download-url",
        { organizationId: "org-1", versionId: "version-1" }
      ),
      { params: Promise.resolve({ documentId: "document-1" }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    )
    expect(createDocumentDownloadUrl).toHaveBeenCalledWith({
      actorUserId: "user-1",
      organizationId: "org-1",
      documentId: "document-1",
      versionId: "version-1",
    })
  })
})

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}
