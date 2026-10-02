import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { getClaims, spend } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  spend: vi.fn(),
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}))
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: spend,
}))

import { RateLimitError } from "@/lib/rate-limit"

import { proxy } from "./proxy"

const request = (path: string, method = "GET") =>
  new NextRequest(`https://app.example.com${path}`, { headers: { "x-forwarded-for": "203.0.113.9" }, method })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("SUPABASE_URL", "http://localhost:54321")
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
  getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } })
})

describe("proxy rate limits", () => {
  it("refuses an over-budget address before looking up the session", async () => {
    spend.mockRejectedValue(new RateLimitError(30))

    const response = await proxy(request("/dashboard"))

    expect(response.status).toBe(429)
    expect(getClaims).not.toHaveBeenCalled()
  })

  it("refuses an over-budget member's API call after their session is verified", async () => {
    spend.mockImplementation(async (bucket: string) => {
      if (bucket === "member_request") throw new RateLimitError(30)
    })

    const response = await proxy(request("/api/search?q=a"))

    expect(response.status).toBe(429)
    expect(spend).toHaveBeenCalledWith("member_request", "user-1")
  })

  it("lets a request within both budgets through", async () => {
    spend.mockResolvedValue(undefined)

    expect((await proxy(request("/api/search?q=a"))).status).toBe(200)
  })
})
