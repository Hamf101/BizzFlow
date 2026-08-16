import { afterEach, describe, expect, it, vi } from "vitest"

import {
  checkpointPublicFormDraft,
  requestPublicFormFileUpload,
  supersedePublicFormFile,
} from "./public-form-file-client"

const DRAFT_TOKEN = "a".repeat(64)
const CHECKSUM = "b".repeat(64)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("public form file client", () => {
  it.each([
    ["checkbox", { upload_evidence: true }],
    ["dropdown", { upload_evidence: "Upload" }],
  ] as const)(
    "checkpoints revealed %s controller answers before allocation",
    async (_controllerType, answers) => {
      const allocation = {
        draftToken: DRAFT_TOKEN,
        expiresInSeconds: 900,
        fileId: "50000000-0000-4000-8000-000000000001",
        safeFilename: "proof.pdf",
        storageKey: "private/proof.pdf",
        uploadUrl: "https://storage.example/upload",
      }
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ draftToken: DRAFT_TOKEN, revision: 2 })
        )
        .mockResolvedValueOnce(Response.json(allocation, { status: 201 }))
      vi.stubGlobal("fetch", fetchMock)

      const checkpoint = await checkpointPublicFormDraft({
        token: "public/token",
        draftToken: DRAFT_TOKEN,
        draftRevision: 1,
        answers,
      })
      await requestPublicFormFileUpload({
        token: "public/token",
        draftToken: checkpoint.draftToken,
        fieldKey: "conditional_evidence",
        originalFilename: "proof.pdf",
        contentType: "application/pdf",
        byteSize: 32,
        checksumSha256: CHECKSUM,
      })

      expect(fetchMock.mock.calls[0]).toEqual([
        "/api/public-forms/public%2Ftoken/draft",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftToken: DRAFT_TOKEN,
            expectedRevision: 1,
            values: answers,
          }),
        },
      ])
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        "/api/public-forms/public%2Ftoken/file-upload-url"
      )
    }
  )

  it("requests recoverable server-side removal for an uploaded file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      fileId: "50000000-0000-4000-8000-000000000001",
    }))
    vi.stubGlobal("fetch", fetchMock)

    await supersedePublicFormFile({
      token: "public-token",
      draftToken: DRAFT_TOKEN,
      fileId: "50000000-0000-4000-8000-000000000001",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/public-forms/public-token/file-supersede",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftToken: DRAFT_TOKEN,
          fileId: "50000000-0000-4000-8000-000000000001",
        }),
      }
    )
  })
})
