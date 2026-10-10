import { afterEach, describe, expect, it, vi } from "vitest"

import { MockSmsProvider } from "@/services/sms/mock-provider"
import { getSmsProvider, resetSmsProviderState } from "@/services/sms/provider-factory"
import { TermiiSmsProvider } from "@/services/sms/termii-provider"

describe("getSmsProvider", () => {
  afterEach(() => {
    resetSmsProviderState()
    delete process.env.SMS_PROVIDER
    delete process.env.TERMII_API_KEY
    vi.unstubAllEnvs()
  })

  it("returns injected provider override when supplied", () => {
    const customProvider = new MockSmsProvider()
    const provider = getSmsProvider({ smsProvider: customProvider })
    expect(provider).toBe(customProvider)
  })

  it("defaults to MockSmsProvider when SMS_PROVIDER is mock or unset", () => {
    const provider = getSmsProvider()
    expect(provider).toBeInstanceOf(MockSmsProvider)
  })

  it("returns TermiiSmsProvider when SMS_PROVIDER=termii and TERMII_API_KEY is present", () => {
    process.env.SMS_PROVIDER = "termii"
    process.env.TERMII_API_KEY = "test-key"

    const provider = getSmsProvider()
    expect(provider).toBeInstanceOf(TermiiSmsProvider)
  })

  it.each([
    ["the mock provider in production", { NODE_ENV: "production", SMS_PROVIDER: "mock" }],
    ["the default provider on a Vercel production deploy", { VERCEL_ENV: "production" }],
    ["termii without its key anywhere", { SMS_PROVIDER: "termii" }],
  ])("refuses %s instead of reporting fake sends", (_label: string, env: Record<string, string>) => {
    Object.entries(env).forEach(([name, value]) => vi.stubEnv(name, value))

    expect(() => getSmsProvider()).toThrow(/SMS/)
  })
})
