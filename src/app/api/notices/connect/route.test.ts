import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"

import { GET } from "./route"

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAuthenticatedUser: vi.fn(),
}))
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
}))
vi.mock("@/lib/env", () => ({
  getPublicSupabaseEnv: () => ({ SUPABASE_PUBLISHABLE_KEY: "public-key", SUPABASE_URL: "https://db.example" }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

describe("GET /api/notices/connect", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(createClient).mockResolvedValue({
      auth: { getSession: async () => ({ data: { session: { access_token: "member-token", expires_at: 1234 } } }) },
    } as never)
  })

  it("gives a member the channel that carries their own id, and their own token", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "user-1" } as never)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.json()).toEqual({
      expiresAt: 1234,
      key: "public-key",
      token: "member-token",
      topic: "user:user-1",
      url: "https://db.example/realtime/v1",
    })
    expect(checkRateLimit).toHaveBeenCalledWith("working_copy_read", "user-1")
  })

  it("turns away someone who is signed out", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new AuthenticationError("Sign in to continue."))

    const response = await GET()

    expect(response.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })
})
