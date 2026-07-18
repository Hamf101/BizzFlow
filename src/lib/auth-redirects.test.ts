import { describe, expect, it } from "vitest"

import {
  buildAcceptInvitePath,
  buildAuthCallbackUrl,
  getSafeNextPath,
} from "@/lib/auth-redirects"

describe("auth redirect helpers", () => {
  it("preserves an encoded internal invitation path", () => {
    const invitePath = buildAcceptInvitePath("invite token/with spaces")

    expect(invitePath).toBe("/accept-invite/invite%20token%2Fwith%20spaces")
    expect(
      buildAuthCallbackUrl("https://app.example.com", invitePath)
    ).toBe(
      "https://app.example.com/auth/callback?next=%2Faccept-invite%2Finvite%2520token%252Fwith%2520spaces"
    )
  })

  it("rejects external and malformed authentication redirects", () => {
    expect(getSafeNextPath("https://malicious.example", "/dashboard")).toBe(
      "/dashboard"
    )
    expect(getSafeNextPath("//malicious.example", "/dashboard")).toBe(
      "/dashboard"
    )
    expect(getSafeNextPath("/accept-invite/token", "/dashboard")).toBe(
      "/accept-invite/token"
    )
  })
})
