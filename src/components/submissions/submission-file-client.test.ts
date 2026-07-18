import { afterEach, describe, expect, it, vi } from "vitest"

import {
  calculateSubmissionFileChecksum,
  completeSubmissionFileUpload,
  resolveSubmissionFileContentType,
  requestSubmissionFileDownload,
  requestSubmissionFileUpload,
  supersedeSubmissionFile,
} from "./submission-file-client"

const CHECKSUM = "a".repeat(64)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("submission file API client", () => {
  it("allocates an encoded submission field upload with revision metadata", async () => {
    const responseBody = {
      expiresInSeconds: 900,
      file: { id: "file-1" },
      uploadUrl: "https://storage.example.com/upload",
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json(responseBody, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestSubmissionFileUpload({
        byteSize: 24,
        checksumSha256: CHECKSUM,
        contentType: "application/pdf",
        expectedRevision: 3,
        fieldKey: "proof",
        organizationId: "org-1",
        originalFilename: "proof.pdf",
        submissionId: "submission/1",
      })
    ).resolves.toEqual(responseBody)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/submissions/submission%2F1/files/upload-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: "org-1",
          expectedRevision: 3,
          fieldKey: "proof",
          originalFilename: "proof.pdf",
          contentType: "application/pdf",
          byteSize: 24,
          checksumSha256: CHECKSUM,
        }),
      }
    )
  })

  it("completes an allocated file through the scoped route", async () => {
    const file = { id: "file-1", status: "available" }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ file }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      completeSubmissionFileUpload({
        fileId: "file/1",
        organizationId: "org-1",
        submissionId: "submission-1",
      })
    ).resolves.toEqual(file)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/submissions/submission-1/files/file%2F1/complete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: "org-1" }),
      }
    )
  })

  it("requests a private download without putting tenant ids in the query string", async () => {
    const result = {
      downloadUrl: "https://storage.example.com/download",
      expiresInSeconds: 900,
    }
    const fetchMock = vi.fn().mockResolvedValue(Response.json(result))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      requestSubmissionFileDownload({
        fileId: "file-1",
        organizationId: "org-1",
        submissionId: "submission-1",
      })
    ).resolves.toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/submissions/submission-1/files/file-1/download-url",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: "org-1" }),
      }
    )
  })

  it("supersedes an active draft file through the scoped route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ fileId: "file-1" }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      supersedeSubmissionFile({
        fileId: "file/1",
        organizationId: "org-1",
        submissionId: "submission-1",
      })
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/submissions/submission-1/files/file%2F1/supersede",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: "org-1" }),
      }
    )
  })

  it("surfaces the application API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "This field already has a file." },
          { status: 409 }
        )
      )
    )

    await expect(
      requestSubmissionFileUpload({
        byteSize: 24,
        checksumSha256: CHECKSUM,
        contentType: "application/pdf",
        expectedRevision: 1,
        fieldKey: "proof",
        organizationId: "org-1",
        originalFilename: "proof.pdf",
        submissionId: "submission-1",
      })
    ).rejects.toThrow("This field already has a file.")
  })
})

describe("submission file browser metadata", () => {
  it("computes a stable lowercase SHA-256 digest", async () => {
    await expect(
      calculateSubmissionFileChecksum(new Blob(["hello"]))
    ).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    )
  })

  it("uses supported extensions when the browser MIME type is missing", () => {
    expect(
      resolveSubmissionFileContentType(
        new File(["a,b"], "report.csv", { type: "" })
      )
    ).toBe("text/csv")
    expect(() =>
      resolveSubmissionFileContentType(
        new File(["alert(1)"], "payload.js", {
          type: "application/javascript",
        })
      )
    ).toThrow("Choose a PDF, PNG, JPG, DOCX, XLSX, or CSV file.")
  })
})
