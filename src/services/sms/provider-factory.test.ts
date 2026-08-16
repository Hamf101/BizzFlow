import { afterEach, describe, expect, it } from "vitest"

import { MockSmsProvider } from "@/services/sms/mock-provider"
import { getSmsProvider, resetSmsProviderState } from "@/services/sms/provider-factory"
import { TermiiSmsProvider } from "@/services/sms/termii-provider"

describe("getSmsProvider", () => {
  afterEach(() => {
    resetSmsProviderState()
    delete process.env.SMS_PROVIDER
    delete process.env.TERMII_API_KEY
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
})
