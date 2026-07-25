import { describe, expect, it } from "vitest"

import { getClientIp } from "./client-ip"

describe("getClientIp", () => {
  it("prefers the platform-set x-real-ip header", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    })

    expect(getClientIp(headers)).toBe("203.0.113.7")
  })

  it("falls back to the first x-forwarded-for entry", () => {
    const headers = new Headers({
      "x-forwarded-for": " 198.51.100.1 , 10.0.0.1",
    })

    expect(getClientIp(headers)).toBe("198.51.100.1")
  })

  it("returns unknown when no forwarding header is present", () => {
    expect(getClientIp(new Headers())).toBe("unknown")
  })

  it("returns unknown for a blank forwarded header", () => {
    expect(getClientIp(new Headers({ "x-forwarded-for": " , 10.0.0.1" }))).toBe(
      "unknown"
    )
  })
})
