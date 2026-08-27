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

  it.each([
    ["/", "/"],
    ["/documents?status=ready#latest", "/documents?status=ready#latest"],
    ["/documents/../dashboard?source=login#recent", "/dashboard?source=login#recent"],
    [
      "/accept-invite/token%252Fpart?source=email%2Bconfirm#finish",
      "/accept-invite/token%252Fpart?source=email%2Bconfirm#finish",
    ],
  ])("preserves the safe internal path %s", (nextPath, expectedPath) => {
    expect(getSafeNextPath(nextPath, "/dashboard")).toBe(expectedPath)
  })

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "https://malicious.example",
    "//malicious.example",
    "///malicious.example",
  ])("rejects an external or non-relative redirect: %s", (nextPath) => {
    expect(getSafeNextPath(nextPath, "/dashboard")).toBe("/dashboard")
  })

  it.each([
    "/..//evil.example",
    "/.%2e//evil.example",
    "/%2e%2e//evil.example",
    "/%252e%252e/%252f%252fevil.example",
    "/%25252e%25252e/%25252f%25252fevil.example",
    "/%2f%2fevil.example",
    "/%252f%252fevil.example",
  ])("rejects a path that normalizes into an authority: %s", (nextPath) => {
    expect(getSafeNextPath(nextPath, "/dashboard")).toBe("/dashboard")
  })

  it.each([
    "/\\evil.example",
    "/safe\\evil.example",
    "/%5cevil.example",
    "/%255cevil.example",
    "/safe%5cevil.example",
    "/safe%255cevil.example",
  ])("rejects raw and encoded backslashes: %s", (nextPath) => {
    expect(getSafeNextPath(nextPath, "/dashboard")).toBe("/dashboard")
  })

  it.each([
    "/documents\nlatest",
    "/documents\u0000latest",
    "/documents\u007flatest",
    "/%0a/evil.example",
    "/%250a/evil.example",
    "/%00/evil.example",
    "/%257f/evil.example",
    "/%",
    "/%zz",
    "/%E0%A4%A",
  ])("rejects control characters and malformed encoding: %s", (nextPath) => {
    expect(getSafeNextPath(nextPath, "/dashboard")).toBe("/dashboard")
  })

  it("uses the safe fallback in an authentication callback URL", () => {
    expect(
      buildAuthCallbackUrl(
        "https://app.example.com",
        "/%252e%252e/%252f%252fevil.example"
      )
    ).toBe("https://app.example.com/auth/callback?next=%2Fdashboard")
  })
})
