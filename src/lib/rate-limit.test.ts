import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createRateLimitCheck,
  hashRateLimitKeyPart,
  RateLimitError,
  type LimiterLike,
} from "./rate-limit"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createRateLimitCheck", () => {
  it("allows requests within the bucket budget", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true, reset: 0 })
    const check = createRateLimitCheck({
      createLimiter: () => ({ limit }),
    })

    await expect(check("auth", "1.2.3.4")).resolves.toBeUndefined()
    expect(limit).toHaveBeenCalledExactlyOnceWith("auth:1.2.3.4")
  })

  it("throws a 429 with retry seconds when the budget is exceeded", async () => {
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockResolvedValue({ success: false, reset: 61_000 }),
      }),
      now: () => 1_000,
    })

    await expect(check("auth", "1.2.3.4")).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 60,
    } satisfies Partial<RateLimitError>)
  })

  it("reports at least one retry second when the window already reset", async () => {
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockResolvedValue({ success: false, reset: 500 }),
      }),
      now: () => 1_000,
    })

    await expect(check("auth", "1.2.3.4")).rejects.toMatchObject({
      retryAfterSeconds: 1,
    } satisfies Partial<RateLimitError>)
  })

  it("allows everything when no limiter is configured", async () => {
    const createLimiter = vi.fn().mockReturnValue(null)
    const check = createRateLimitCheck({ createLimiter })

    await expect(check("upload_initiation", "user-1")).resolves.toBeUndefined()
    await expect(check("upload_initiation", "user-2")).resolves.toBeUndefined()
    expect(createLimiter).toHaveBeenCalledTimes(1)
  })

  it("fails open with an error log when the limiter itself fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockRejectedValue(new Error("redis unreachable")),
      }),
    })

    await expect(check("public_signing", "1.2.3.4")).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalledWith(
      "rate_limit_check_failed",
      expect.objectContaining({ bucket: "public_signing" })
    )
  })

  it("constructs one limiter per bucket and reuses it", async () => {
    const limiter: LimiterLike = {
      limit: vi.fn().mockResolvedValue({ success: true, reset: 0 }),
    }
    const createLimiter = vi.fn().mockReturnValue(limiter)
    const check = createRateLimitCheck({ createLimiter })

    await check("auth", "a")
    await check("auth", "b")
    await check("public_signing", "a")

    expect(createLimiter).toHaveBeenCalledTimes(2)
  })
})

describe("hashRateLimitKeyPart", () => {
  it("normalizes case and whitespace before hashing", () => {
    expect(hashRateLimitKeyPart("  User@Example.COM ")).toBe(
      hashRateLimitKeyPart("user@example.com")
    )
  })

  it("produces a hex digest instead of the raw value", () => {
    const digest = hashRateLimitKeyPart("user@example.com")

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain("example.com")
  })
})
