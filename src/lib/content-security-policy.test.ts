import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy } from "@/lib/content-security-policy"

describe("buildContentSecurityPolicy", () => {
  it("allows the configured object-storage origin for browser uploads", () => {
    const policy = buildContentSecurityPolicy({
      appUrl: "http://localhost:3000",
      isProduction: true,
      r2Endpoint: "http://127.0.0.1:9000",
    })

    expect(policy).toContain(
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co " +
        "https://*.r2.cloudflarestorage.com http://127.0.0.1:9000"
    )
    expect(policy).not.toContain("upgrade-insecure-requests")
  })

  it("adds production transport hardening only for an HTTPS app", () => {
    const policy = buildContentSecurityPolicy({
      appUrl: "https://app.bizflow.example",
      isProduction: true,
    })

    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).toContain("upgrade-insecure-requests")
  })

  it("keeps development evaluation support without transport upgrading", () => {
    const policy = buildContentSecurityPolicy({
      appUrl: "http://localhost:3000",
      isProduction: false,
    })

    expect(policy).toContain("'unsafe-eval'")
    expect(policy).not.toContain("upgrade-insecure-requests")
  })

  it("ignores invalid or non-HTTP origins instead of injecting CSP text", () => {
    const policy = buildContentSecurityPolicy({
      appUrl: "https://app.bizflow.example",
      isProduction: true,
      posthogHost: "https://analytics.example; script-src *",
      posthogKey: "phc_test",
      r2Endpoint: "data:text/plain,unsafe",
    })

    expect(policy).not.toContain("analytics.example")
    expect(policy).not.toContain("data:text/plain")
    expect(policy.match(/script-src/g)).toHaveLength(1)
  })
})
