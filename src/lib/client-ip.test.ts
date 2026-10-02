import { afterEach, describe, expect, it, vi } from "vitest"

import { getClientIp } from "./client-ip"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getClientIp", () => {
  it("takes the entry the trusted proxy appended, not one the client wrote", () => {
    // A client can send "X-Forwarded-For: 1.2.3.4"; the proxy appends the real peer.
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.1" })

    expect(getClientIp(headers)).toBe("198.51.100.1")
  })

  it("skips one entry per extra trusted proxy in front of the app", () => {
    vi.stubEnv("TRUSTED_PROXY_COUNT", "2")
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4, 198.51.100.1, 10.0.0.1",
    })

    expect(getClientIp(headers)).toBe("198.51.100.1")
  })

  it("reads whichever single-value header the host's proxy sets", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP")
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    })

    expect(getClientIp(headers)).toBe("203.0.113.7")
  })

  it("ignores headers other than the configured one", () => {
    expect(getClientIp(new Headers({ "x-real-ip": "203.0.113.7" }))).toBe("unknown")
  })

  it("returns unknown when the chain is shorter than the trusted proxy count", () => {
    vi.stubEnv("TRUSTED_PROXY_COUNT", "3")

    expect(getClientIp(new Headers({ "x-forwarded-for": "198.51.100.1" }))).toBe("unknown")
  })

  it("returns unknown when no forwarding header is present", () => {
    expect(getClientIp(new Headers())).toBe("unknown")
  })

  it("falls back to one trusted proxy when the count is not a positive integer", () => {
    vi.stubEnv("TRUSTED_PROXY_COUNT", "abc")

    expect(getClientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 198.51.100.1" }))).toBe("198.51.100.1")
  })
})
