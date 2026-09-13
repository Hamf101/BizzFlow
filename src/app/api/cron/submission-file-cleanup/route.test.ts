import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cleanupExpiredSubmissionFileObjects = vi.hoisted(() => vi.fn())
const expireAbandonedSubmissionFiles = vi.hoisted(() => vi.fn())

vi.mock("@/services/submission-service", () => ({
  cleanupExpiredSubmissionFileObjects,
  expireAbandonedSubmissionFiles,
}))

import { GET } from "./route"

const CRON_SECRET = "test-cron-secret-1234567890"
const originalCronSecret = process.env.CRON_SECRET

describe("submission file cleanup cron route", () => {
  beforeEach(() => {
    cleanupExpiredSubmissionFileObjects.mockReset()
    expireAbandonedSubmissionFiles.mockReset()
    process.env.CRON_SECRET = CRON_SECRET
  })

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalCronSecret
    }
  })

  it("fails closed when the cron secret is missing", async () => {
    delete process.env.CRON_SECRET

    const response = await GET(
      new Request("https://app.example/api/cron/submission-file-cleanup")
    )

    expect(response.status).toBe(503)
    expect(cleanupExpiredSubmissionFileObjects).not.toHaveBeenCalled()
    expect(expireAbandonedSubmissionFiles).not.toHaveBeenCalled()
  })

  it("rejects requests without the exact bearer secret", async () => {
    const response = await GET(
      new Request("https://app.example/api/cron/submission-file-cleanup", {
        headers: { authorization: "Bearer wrong-secret" },
      })
    )

    expect(response.status).toBe(401)
    expect(cleanupExpiredSubmissionFileObjects).not.toHaveBeenCalled()
    expect(expireAbandonedSubmissionFiles).not.toHaveBeenCalled()
  })

  it("expires abandoned uploads, then cleans up, for an authenticated cron request", async () => {
    expireAbandonedSubmissionFiles.mockResolvedValue({
      expiredDrafts: 1,
      expiredFiles: 3,
    })
    cleanupExpiredSubmissionFileObjects.mockResolvedValue({
      attempted: 3,
      cleaned: 3,
      failed: 0,
    })

    const response = await GET(createAuthorizedRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual({
      expiredDrafts: 1,
      expiredFiles: 3,
      attempted: 3,
      cleaned: 3,
      failed: 0,
    })
    expect(
      expireAbandonedSubmissionFiles.mock.invocationCallOrder[0]
    ).toBeLessThan(cleanupExpiredSubmissionFileObjects.mock.invocationCallOrder[0])
  })

  it("still cleans up when expiry fails, and reports the failure", async () => {
    expireAbandonedSubmissionFiles.mockRejectedValue(
      new Error("database unavailable")
    )
    cleanupExpiredSubmissionFileObjects.mockResolvedValue({
      attempted: 1,
      cleaned: 1,
      failed: 0,
    })

    const response = await GET(createAuthorizedRequest())

    expect(response.status).toBe(500)
    expect(cleanupExpiredSubmissionFileObjects).toHaveBeenCalledOnce()
  })
})

function createAuthorizedRequest(): Request {
  return new Request("https://app.example/api/cron/submission-file-cleanup", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
}
