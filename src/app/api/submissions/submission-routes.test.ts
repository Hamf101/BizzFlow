import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  allocateInternalSubmissionFile: vi.fn(),
  completeInternalSubmissionFile: vi.fn(),
  createInternalSubmissionFileDownloadUrl: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  readTrustedJsonObject: vi.fn(),
  supersedeInternalSubmissionFile: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}))

vi.mock("@/lib/request-security", () => ({
  RequestSecurityError: class RequestSecurityError extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
  readTrustedJsonObject: mocks.readTrustedJsonObject,
}))

vi.mock("@/services/submission-service", () => ({
  SubmissionServiceError: class SubmissionServiceError extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
  allocateInternalSubmissionFile: mocks.allocateInternalSubmissionFile,
  completeInternalSubmissionFile: mocks.completeInternalSubmissionFile,
  createInternalSubmissionFileDownloadUrl:
    mocks.createInternalSubmissionFileDownloadUrl,
  supersedeInternalSubmissionFile: mocks.supersedeInternalSubmissionFile,
}))

import { AuthenticationError } from "@/lib/auth"
import { SubmissionServiceError } from "@/services/submission-service"

import { POST as allocateFile } from "./[submissionId]/files/upload-url/route"
import { POST as completeFile } from "./[submissionId]/files/[fileId]/complete/route"
import { POST as downloadFile } from "./[submissionId]/files/[fileId]/download-url/route"
import { POST as supersedeFile } from "./[submissionId]/files/[fileId]/supersede/route"

const actor = { id: "11111111-1111-4111-8111-111111111111" }
const organizationId = "22222222-2222-4222-8222-222222222222"
const submissionId = "33333333-3333-4333-8333-333333333333"
const fileId = "44444444-4444-4444-8444-444444444444"
const checksumSha256 = "a".repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getAuthenticatedUser.mockResolvedValue(actor)
})

describe("submission file routes", () => {
  it("maps a trusted allocation request into the typed service", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({
      organizationId,
      expectedRevision: 4,
      fieldKey: "proof",
      originalFilename: "proof.pdf",
      contentType: "application/pdf",
      byteSize: 128,
      checksumSha256,
    })
    mocks.allocateInternalSubmissionFile.mockResolvedValue({
      file: { id: fileId },
      uploadUrl: "https://storage.example.com/upload",
      expiresInSeconds: 900,
    })

    const response = await allocateFile(createJsonRequest(), {
      params: Promise.resolve({ submissionId }),
    })

    expect(response.status).toBe(201)
    expect(mocks.allocateInternalSubmissionFile).toHaveBeenCalledWith({
      actorUserId: actor.id,
      organizationId,
      submissionId,
      expectedRevision: 4,
      fieldKey: "proof",
      originalFilename: "proof.pdf",
      contentType: "application/pdf",
      byteSize: 128,
      checksumSha256,
    })
  })

  it("completes a scoped file allocation", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({ organizationId })
    mocks.completeInternalSubmissionFile.mockResolvedValue({
      file: { id: fileId, status: "available" },
    })

    const response = await completeFile(createJsonRequest(), {
      params: Promise.resolve({ fileId, submissionId }),
    })

    expect(response.status).toBe(200)
    expect(mocks.completeInternalSubmissionFile).toHaveBeenCalledWith({
      actorUserId: actor.id,
      organizationId,
      submissionId,
      fileId,
    })
  })

  it("returns signed downloads with private no-store headers", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({ organizationId })
    mocks.createInternalSubmissionFileDownloadUrl.mockResolvedValue({
      downloadUrl: "https://storage.example.com/download",
      expiresInSeconds: 900,
    })

    const response = await downloadFile(createJsonRequest(), {
      params: Promise.resolve({ fileId, submissionId }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    )
    expect(mocks.createInternalSubmissionFileDownloadUrl).toHaveBeenCalledWith({
      actorUserId: actor.id,
      organizationId,
      submissionId,
      fileId,
    })
  })

  it("supersedes an active file without exposing its storage key", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({ organizationId })
    mocks.supersedeInternalSubmissionFile.mockResolvedValue({
      fileId,
      storageKey: "private/storage/key",
    })

    const response = await supersedeFile(createJsonRequest(), {
      params: Promise.resolve({ fileId, submissionId }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    )
    await expect(response.json()).resolves.toEqual({ fileId })
    expect(mocks.supersedeInternalSubmissionFile).toHaveBeenCalledWith({
      actorUserId: actor.id,
      organizationId,
      submissionId,
      fileId,
    })
  })

  it("preserves typed service conflicts", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({
      organizationId,
      expectedRevision: 1,
      fieldKey: "proof",
      originalFilename: "proof.pdf",
      contentType: "application/pdf",
      byteSize: 128,
      checksumSha256,
    })
    mocks.allocateInternalSubmissionFile.mockRejectedValue(
      new SubmissionServiceError("This field already has a file.", 409)
    )

    const response = await allocateFile(createJsonRequest(), {
      params: Promise.resolve({ submissionId }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "This field already has a file.",
    })
  })

  it("returns 401 before touching submission services when auth fails", async () => {
    mocks.getAuthenticatedUser.mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    const response = await completeFile(createJsonRequest(), {
      params: Promise.resolve({ fileId, submissionId }),
    })

    expect(response.status).toBe(401)
    expect(mocks.completeInternalSubmissionFile).not.toHaveBeenCalled()
  })
})

function createJsonRequest(): Request {
  return new Request("https://app.example.com/api/submissions/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
}
