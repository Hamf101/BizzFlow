import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy } from "@/lib/content-security-policy"

describe("buildContentSecurityPolicy", () => {
  it("allows the configured object-storage origin for uploads and stored pictures", () => {
    const policy = buildContentSecurityPolicy({
      appUrl: "http://localhost:3000",
      isProduction: true,
      r2Endpoint: "http://127.0.0.1:9000",
    })

    expect(policy).toContain("connect-src 'self' http://127.0.0.1:9000")
    expect(policy).toContain("img-src 'self' data: blob: http://127.0.0.1:9000")
    expect(policy).not.toContain("*")
    expect(policy).not.toContain("upgrade-insecure-requests")
  })

  it("lets editors reach the configured Supabase's live channel", () => {
    const local = buildContentSecurityPolicy({ isProduction: true, supabaseUrl: "http://127.0.0.1:54321" })
    const hosted = buildContentSecurityPolicy({ isProduction: true, supabaseUrl: "https://project.example.com" })

    expect(local).toMatch(/connect-src [^;]* ws:\/\/127\.0\.0\.1:54321(;| )/)
    expect(hosted).toMatch(/connect-src [^;]* https:\/\/project\.example\.com wss:\/\/project\.example\.com(;| )/)
  })

  it("fails a deployment build loudly when an origin the policy or HSTS needs is missing", () => {
    const complete = {
      appUrl: "https://app.bizflow.example",
      isProduction: true,
      r2Endpoint: "https://account.r2.cloudflarestorage.com",
      requireOrigins: true,
      supabaseUrl: "https://project.supabase.co",
    }

    expect(() => buildContentSecurityPolicy(complete)).not.toThrow()
    expect(() => buildContentSecurityPolicy({ ...complete, r2Endpoint: undefined })).toThrow("CLOUDFLARE_R2_ENDPOINT")
    expect(() => buildContentSecurityPolicy({ ...complete, supabaseUrl: "not a url" })).toThrow("SUPABASE_URL")
    expect(() => buildContentSecurityPolicy({ ...complete, appUrl: "http://app.bizflow.example" })).toThrow("NEXT_PUBLIC_APP_URL")
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
      supabaseUrl: "javascript:alert(1)",
    })

    expect(policy).not.toContain("analytics.example")
    expect(policy).not.toContain("data:text/plain")
    expect(policy).not.toContain("javascript:")
    expect(policy.match(/script-src/g)).toHaveLength(1)
  })
})
