import { describe, expect, it, vi } from "vitest"

import { RateLimitError, type CheckRateLimit } from "./rate-limit"
import { limitRequestByIp, limitRequestByMember } from "./request-rate-limit"

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://app.example.com${path}`, {
    headers: { "x-forwarded-for": "203.0.113.9" },
    ...init,
  })
}

/** A check that denies the named bucket and allows the rest. */
function denying(bucket: string): CheckRateLimit {
  return vi.fn(async (name) => {
    if (name === bucket) throw new RateLimitError(42)
  })
}

describe("limitRequestByIp", () => {
  it("spends the caller's address budget on an ordinary page request", async () => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await expect(limitRequestByIp(request("/login"), { check })).resolves.toBeNull()
    expect(check).toHaveBeenCalledExactlyOnceWith("request_ip", "203.0.113.9")
  })

  it("answers 429 with a retry hint once the address is over budget", async () => {
    const response = await limitRequestByIp(request("/login"), { check: denying("request_ip") })

    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toBe("42")
  })

  it.each([
    ["the editor's live sync, which has per-member budgets", "/api/templates/t-1/room/updates"],
    ["the token renewal for it", "/api/working-copies/token"],
    ["the background-job endpoint, called from the job host's few addresses", "/api/inngest"],
  ])("leaves %s to its own limits", async (_name, path) => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await expect(limitRequestByIp(request(path), { check })).resolves.toBeNull()
    expect(check).not.toHaveBeenCalled()
  })
})

describe("limitRequestByMember", () => {
  it.each([
    ["an API read such as search", "/api/search?q=a", "GET"],
    ["an API call such as a file download link", "/api/documents/d-1/download-url", "POST"],
    ["a server action, which posts to a page", "/templates", "POST"],
  ])("spends the member's budget on %s", async (_name, path, method) => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await expect(limitRequestByMember(request(path, { method }), "user-1", { check })).resolves.toBeNull()
    expect(check).toHaveBeenCalledExactlyOnceWith("member_request", "user-1")
  })

  it("leaves rendering a page alone", async () => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await expect(limitRequestByMember(request("/templates"), "user-1", { check })).resolves.toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it("holds a CSV export to its own, smaller budget instead", async () => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await limitRequestByMember(request("/api/export/submissions?query=x"), "user-1", { check })

    expect(check).toHaveBeenCalledExactlyOnceWith("member_export", "user-1")
  })

  it("answers 429 with a retry hint once the member is over budget", async () => {
    const response = await limitRequestByMember(request("/api/search?q=a"), "user-1", {
      check: denying("member_request"),
    })

    expect(response?.status).toBe(429)
    expect(response?.headers.get("Retry-After")).toBe("42")
  })

  it("leaves the editor's live sync to its own limits", async () => {
    const check = vi.fn<CheckRateLimit>().mockResolvedValue()

    await limitRequestByMember(request("/api/documents/d-1/room/updates", { method: "POST" }), "user-1", { check })

    expect(check).not.toHaveBeenCalled()
  })
})
