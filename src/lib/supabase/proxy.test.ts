import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { isProtectedPath, updateSession } from "./proxy"

const limited = vi.hoisted(() => ({ response: null as Response | null }))

vi.mock("@supabase/ssr", () => ({
  // A session refresh: the client rotates the cookie, then reports the member.
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (cookies: unknown[], headers: Record<string, string>) => void } }
  ) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll(
          [{ name: "sb-auth-token", value: "refreshed", options: { path: "/" } }],
          {}
        )
        return { data: { claims: { sub: "member-1" } } }
      },
    },
  }),
}))

vi.mock("@/lib/request-rate-limit", () => ({
  limitRequestByMember: async () => limited.response,
}))

afterEach(() => {
  vi.unstubAllEnvs()
  limited.response = null
})

describe("isProtectedPath", () => {
  it("treats dashboard and people routes as protected", () => {
    expect(isProtectedPath("/dashboard")).toBe(true)
    expect(isProtectedPath("/dashboard/settings")).toBe(true)
    expect(isProtectedPath("/people")).toBe(true)
    expect(isProtectedPath("/people/team")).toBe(true)
    expect(isProtectedPath("/audit-log")).toBe(true)
    expect(isProtectedPath("/documents")).toBe(true)
    expect(isProtectedPath("/documents/document-1")).toBe(true)
    expect(isProtectedPath("/templates")).toBe(true)
    expect(isProtectedPath("/templates/template-1")).toBe(true)
    expect(isProtectedPath("/submissions")).toBe(true)
    expect(isProtectedPath("/submissions/submission-1")).toBe(true)
    expect(isProtectedPath("/settings")).toBe(true)
    expect(isProtectedPath("/settings/notifications")).toBe(true)
    expect(isProtectedPath("/tasks")).toBe(true)
    expect(isProtectedPath("/tasks/task-1")).toBe(true)
    expect(isProtectedPath("/dashboard-preview")).toBe(false)
    expect(isProtectedPath("/documents-public")).toBe(false)
    expect(isProtectedPath("/submissions-public")).toBe(false)
    expect(isProtectedPath("/tasks-public")).toBe(false)
    expect(isProtectedPath("/login")).toBe(false)
  })
})

describe("updateSession", () => {
  it("keeps the refreshed session cookie on a rate-limited response", async () => {
    // Dropping it would leave the browser on a token the refresh just spent,
    // signing the member out on their next request.
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test")
    limited.response = new Response("Too many requests.", { status: 429 })

    const response = await updateSession(
      new NextRequest("https://app.test/api/documents", { method: "POST" })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("set-cookie")).toContain("sb-auth-token=refreshed")
  })
})
