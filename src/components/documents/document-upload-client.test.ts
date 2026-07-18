import { afterEach, describe, expect, it, vi } from "vitest"

import {
  completeDocumentUploadRequest,
  readApiErrorMessage,
  uploadFileToSignedUrl,
} from "./document-upload-client"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("document upload client", () => {
  it("treats a create-only retry response as an idempotent upload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 412 }))
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["pdf"], "contract.pdf", {
      type: "application/pdf",
    })

    await expect(
      uploadFileToSignedUrl(
        "https://storage.example.com/upload",
        file,
        "Upload failed."
      )
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example.com/upload",
      {
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          "if-none-match": "*",
        },
        body: file,
      }
    )
  })

  it("rejects a non-idempotent storage error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }))
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["pdf"], "contract.pdf", {
      type: "application/pdf",
    })

    await expect(
      uploadFileToSignedUrl(
        "https://storage.example.com/upload",
        file,
        "Upload failed."
      )
    ).rejects.toThrow("Upload failed.")
  })

  it("uses the standard API error payload for completion failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: "Version no longer exists." }, { status: 404 })
      )
    )

    await expect(
      completeDocumentUploadRequest(
        {
          documentId: "document-1",
          versionId: "version-1",
          uploadUrl: "https://storage.example.com/upload",
          storageKey: "documents/document-1/version-1.pdf",
          expiresInSeconds: 900,
        },
        "org-1",
        "Completion failed."
      )
    ).rejects.toThrow("Version no longer exists.")
  })

  it("falls back when an API response is not JSON", async () => {
    const response = new Response("upstream failed", { status: 502 })

    await expect(readApiErrorMessage(response, "Request failed.")).resolves.toBe(
      "Request failed."
    )
  })
})
