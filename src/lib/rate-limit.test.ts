import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createMemoryLimiter,
  createRateLimitCheck,
  hashRateLimitKeyPart,
  RateLimitError,
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

  it("fails open when the limiter itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockRejectedValue(new Error("redis unreachable")),
      }),
    })

    await expect(check("public_signing", "1.2.3.4")).resolves.toBeUndefined()
  })

  it("fails closed when a spend-bearing bucket's limiter fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockRejectedValue(new Error("redis unreachable")),
      }),
    })

    await expect(check("ai_flow", "org-1:user-1")).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 30,
    } satisfies Partial<RateLimitError>)
    await expect(
      check("outbound_email", "user-1")
    ).rejects.toBeInstanceOf(RateLimitError)
  })

  it("treats a limiter that timed out as unavailable, so only spend-bearing buckets deny", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    // Upstash resolves a check that ran out of time as allowed, marked "timeout".
    const check = createRateLimitCheck({
      createLimiter: () => ({
        limit: vi.fn().mockResolvedValue({ reason: "timeout", reset: 0, success: true }),
      }),
    })

    await expect(check("ai_flow_daily", "org-1")).rejects.toMatchObject({
      statusCode: 429,
      retryAfterSeconds: 30,
    } satisfies Partial<RateLimitError>)
    await expect(check("auth", "1.2.3.4")).resolves.toBeUndefined()
  })

  it("allows fail-closed buckets when no limiter is configured at all", async () => {
    const check = createRateLimitCheck({ createLimiter: () => null })

    await expect(check("ai_flow", "org-1:user-1")).resolves.toBeUndefined()
    await expect(check("outbound_email", "user-1")).resolves.toBeUndefined()
    await expect(check("email_recipient", "a:b:c")).resolves.toBeUndefined()
  })

  it("stops calling a failing limiter for 30 seconds, keeping each bucket's fail mode and logging once", async () => {
    // Without the breaker every request waits out the limiter's timeout twice
    // and floods the logs for the whole outage.
    let clock = 0
    const limit = vi.fn().mockRejectedValue(new Error("upstash down"))
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    const check = createRateLimitCheck({
      createLimiter: () => ({ limit }),
      now: () => clock,
    })

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await check("auth", `ip-${attempt}`)
    }
    const callsWhileOpen = limit.mock.calls.length

    await expect(check("auth", "1.2.3.4")).resolves.toBeUndefined()
    await expect(check("ai_flow", "member-1")).rejects.toMatchObject({ statusCode: 429 })
    expect(callsWhileOpen).toBe(3)
    expect(limit).toHaveBeenCalledTimes(3)
    expect(errorLog.mock.calls.length).toBeLessThanOrEqual(4)

    clock = 30_000
    await check("auth", "1.2.3.4")
    expect(limit).toHaveBeenCalledTimes(4)
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

describe("createMemoryLimiter", () => {
  it("denies past the limit until the window ends, per key", async () => {
    let now = 0
    const limiter = createMemoryLimiter({ limit: 2, windowSeconds: 60, now: () => now })

    expect((await limiter.limit("a")).success).toBe(true)
    expect((await limiter.limit("a")).success).toBe(true)
    expect(await limiter.limit("a")).toEqual({ success: false, reset: 60_000 })
    expect((await limiter.limit("b")).success).toBe(true)

    now = 60_000
    expect((await limiter.limit("a")).success).toBe(true)
  })

  it("stays bounded when an attacker rotates keys", async () => {
    const limiter = createMemoryLimiter({ limit: 1, windowSeconds: 60, maxKeys: 2, now: () => 0 })

    await limiter.limit("a")
    await limiter.limit("b")
    await limiter.limit("c")

    // "a" was the oldest and was dropped to make room; "c" is still counted.
    expect((await limiter.limit("a")).success).toBe(true)
    expect((await limiter.limit("c")).success).toBe(false)
  })
})

describe("production without Redis", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("still throttles from process memory instead of allowing everything", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "")
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "")
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const check = createRateLimitCheck()

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await check("public_form_submission", "198.51.100.5")
    }

    await expect(check("public_form_submission", "198.51.100.5")).rejects.toThrow(RateLimitError)
  })
})
