import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkRateLimit, RateLimitError } from "@/lib/rate-limit"

import {
  enforceActionRateLimit,
  enforceOutboundEmailRateLimit,
} from "./action-rate-limit"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>()
  return { ...actual, checkRateLimit: vi.fn() }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(checkRateLimit).mockResolvedValue(undefined)
})

describe("action rate-limit redirects", () => {
  it("uses stable dashboard feedback for outbound email throttling", async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new RateLimitError(60))

    await expect(
      enforceOutboundEmailRateLimit({
        userId: "20000000-0000-4000-8000-000000000001",
        redirectPath: "/people",
      })
    ).rejects.toThrow("NEXT_REDIRECT:/people?feedback=retry_later")
  })

  it("preserves fixed inline copy for routes without the dashboard bridge", async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(new RateLimitError(60))

    await expect(
      enforceActionRateLimit({
        bucket: "auth",
        key: "hashed-address",
        message: "Too many sign-in attempts.",
        redirectPath: "/login",
      })
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?error=Too+many+sign-in+attempts."
    )
  })

  it("does not flatten unexpected limiter failures into a redirect", async () => {
    vi.mocked(checkRateLimit).mockRejectedValueOnce(
      new Error("limiter connection failed")
    )

    await expect(
      enforceOutboundEmailRateLimit({
        userId: "20000000-0000-4000-8000-000000000001",
        redirectPath: "/people",
      })
    ).rejects.toThrow("limiter connection failed")
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
