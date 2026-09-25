import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

import { GET } from "./route"

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe("authentication callback redirects", () => {
  it("uses the configured application origin instead of the request host", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      },
    } as never)

    const response = await GET(
      new NextRequest(
        "https://attacker.example.net/auth/callback?code=code-1&next=/documents"
      )
    )

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/documents"
    )
  })

  it("sends someone who confirmed on another device to log in, then on to where they were going", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com"
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: { message: "code verifier missing" } }),
      },
    } as never)

    const response = await GET(
      new NextRequest("https://app.example.com/auth/callback?code=code-1&next=/dashboard")
    )

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/login?confirmed=1&next=%2Fdashboard"
    )
  })

  it("fails closed when the canonical application URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await GET(
      new NextRequest("https://attacker.example.net/auth/callback?code=code-1")
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: "Authentication callback is not configured.",
    })
    expect(createClient).not.toHaveBeenCalled()
  })
})
