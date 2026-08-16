import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  readTrustedJsonObject: vi.fn(),
  savePublicFormDraft: vi.fn(),
  supersedePublicFormFile: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  RateLimitError: class RateLimitError extends Error {},
  checkRateLimit: mocks.checkRateLimit,
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

vi.mock("@/services/public-form-service", () => ({
  PublicFormServiceError: class PublicFormServiceError extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
  savePublicFormDraft: mocks.savePublicFormDraft,
  supersedePublicFormFile: mocks.supersedePublicFormFile,
}))

import { PublicFormServiceError } from "@/services/public-form-service"

import { POST as checkpointDraft } from "./[token]/draft/route"
import { POST as supersedeFile } from "./[token]/file-supersede/route"

const DRAFT_TOKEN = "a".repeat(64)
const FILE_ID = "50000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.checkRateLimit.mockResolvedValue(undefined)
})

describe("public form draft routes", () => {
  it("checkpoints controller answers and sets a path-scoped HttpOnly cookie", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({
      draftToken: null,
      expectedRevision: null,
      values: { upload_evidence: true },
    })
    mocks.savePublicFormDraft.mockResolvedValue({
      draftToken: DRAFT_TOKEN,
      revision: 1,
    })

    const response = await checkpointDraft(createJsonRequest(), {
      params: Promise.resolve({ token: "public-token" }),
    })

    expect(response.status).toBe(200)
    expect(mocks.savePublicFormDraft).toHaveBeenCalledWith({
      token: "public-token",
      draftToken: null,
      expectedRevision: null,
      values: { upload_evidence: true },
    })
    expect(response.headers.get("set-cookie")).toContain(
      "bizflow_public_form_draft="
    )
    expect(response.headers.get("set-cookie")).toContain(
      "Path=/forms/public-token"
    )
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
  })

  it("maps public file removal into the token-scoped service", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({
      draftToken: DRAFT_TOKEN,
      fileId: FILE_ID,
    })
    mocks.supersedePublicFormFile.mockResolvedValue({ fileId: FILE_ID })

    const response = await supersedeFile(createJsonRequest(), {
      params: Promise.resolve({ token: "public-token" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(mocks.supersedePublicFormFile).toHaveBeenCalledWith({
      token: "public-token",
      draftToken: DRAFT_TOKEN,
      fileId: FILE_ID,
    })
  })

  it("preserves typed stale-draft conflicts", async () => {
    mocks.readTrustedJsonObject.mockResolvedValue({
      draftToken: DRAFT_TOKEN,
      expectedRevision: 1,
      values: { upload_evidence: true },
    })
    mocks.savePublicFormDraft.mockRejectedValue(
      new PublicFormServiceError("Draft changed.", 409)
    )
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const response = await checkpointDraft(createJsonRequest(), {
      params: Promise.resolve({ token: "public-token" }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "Draft changed." })
  })
})

function createJsonRequest(): Request {
  return new Request("https://app.example/api/public-forms/public-token/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  })
}
