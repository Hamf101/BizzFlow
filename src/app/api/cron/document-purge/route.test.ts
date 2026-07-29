import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const processDueResourcePurges = vi.hoisted(() => vi.fn())

vi.mock("@/services/document-service", () => ({
  processDueResourcePurges,
}))

import { GET } from "./route"

const CRON_SECRET = "test-cron-secret-1234567890"
const originalCronSecret = process.env.CRON_SECRET

describe("document purge cron route", () => {
  beforeEach(() => {
    processDueResourcePurges.mockReset()
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
      new Request("https://app.example/api/cron/document-purge")
    )

    expect(response.status).toBe(503)
    expect(processDueResourcePurges).not.toHaveBeenCalled()
  })

  it("rejects requests without the exact bearer secret", async () => {
    const response = await GET(
      new Request("https://app.example/api/cron/document-purge", {
        headers: { authorization: "Bearer wrong-secret" },
      })
    )

    expect(response.status).toBe(401)
    expect(processDueResourcePurges).not.toHaveBeenCalled()
  })

  it("returns content-free bounded counts for an authenticated cron request", async () => {
    processDueResourcePurges.mockResolvedValue({
      enqueued: 2,
      leased: 3,
      deleted: 3,
      retryScheduled: 0,
      permanentlyFailed: 0,
      finalized: 2,
    })

    const response = await GET(
      new Request("https://app.example/api/cron/document-purge", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual({
      enqueued: 2,
      leased: 3,
      deleted: 3,
      retryScheduled: 0,
      permanentlyFailed: 0,
      finalized: 2,
    })
    expect(processDueResourcePurges).toHaveBeenCalledOnce()
  })

  it("returns a no-store server error without leaking provider details", async () => {
    processDueResourcePurges.mockRejectedValue(
      new Error("secret provider response")
    )
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await GET(
      new Request("https://app.example/api/cron/document-purge", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
    )

    expect(response.status).toBe(500)
    expect(response.headers.get("cache-control")).toContain("no-store")
    await expect(response.json()).resolves.toEqual({
      error: "Document purge failed.",
    })
  })
})
