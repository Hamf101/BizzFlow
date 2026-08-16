import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const cleanupExpiredSubmissionFileObjects = vi.hoisted(() => vi.fn())

vi.mock("@/services/submission-service", () => ({
  cleanupExpiredSubmissionFileObjects,
}))

import { GET } from "./route"

const CRON_SECRET = "test-cron-secret-1234567890"
const originalCronSecret = process.env.CRON_SECRET

describe("submission file cleanup cron route", () => {
  beforeEach(() => {
    cleanupExpiredSubmissionFileObjects.mockReset()
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
  })

  it("rejects requests without the exact bearer secret", async () => {
    const response = await GET(
      new Request("https://app.example/api/cron/submission-file-cleanup", {
        headers: { authorization: "Bearer wrong-secret" },
      })
    )

    expect(response.status).toBe(401)
    expect(cleanupExpiredSubmissionFileObjects).not.toHaveBeenCalled()
  })

  it("runs a bounded cleanup for an authenticated cron request", async () => {
    cleanupExpiredSubmissionFileObjects.mockResolvedValue({
      attempted: 2,
      cleaned: 2,
      failed: 0,
    })

    const response = await GET(
      new Request("https://app.example/api/cron/submission-file-cleanup", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual({
      attempted: 2,
      cleaned: 2,
      failed: 0,
    })
    expect(cleanupExpiredSubmissionFileObjects).toHaveBeenCalledOnce()
  })
})
