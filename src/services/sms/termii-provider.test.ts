import { describe, expect, it, vi } from "vitest"

import type { SmsEnv } from "@/lib/env"
import { TermiiProviderError, TermiiSmsProvider } from "@/services/sms/termii-provider"

const mockEnv: SmsEnv = {
  SMS_PROVIDER: "termii",
  TERMII_API_KEY: "test-termii-api-key",
  TERMII_SENDER_ID: "BizFlow",
  TERMII_BASE_URL: "https://api.ng.termii.com/api",
  SMS_TIMEOUT_MS: 5000,
}

describe("TermiiSmsProvider", () => {
  it("constructs TermiiProviderError with status code", () => {
    const err = new TermiiProviderError("API failed", 502)
    expect(err.name).toBe("TermiiProviderError")
    expect(err.statusCode).toBe(502)
    expect(err.message).toBe("API failed")
  })

  it("throws if TERMII_API_KEY is missing", () => {
    expect(
      () =>
        new TermiiSmsProvider({
          ...mockEnv,
          TERMII_API_KEY: undefined,
        })
    ).toThrow("Termii API key is required when using termii provider.")
  })

  it("sends SMS payload to Termii REST API and returns success result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "termii-msg-12345", status: "success" }),
    })

    const provider = new TermiiSmsProvider(mockEnv, { fetchImpl: fetchImpl as never })

    const result = await provider.sendSms({
      recipientPhone: "+14155552671",
      message: "Test message",
      reference: "ref-1",
    })

    expect(result).toEqual({
      success: true,
      messageId: "termii-msg-12345",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.ng.termii.com/api/sms/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          api_key: "test-termii-api-key",
          to: "+14155552671",
          from: "BizFlow",
          sms: "Test message",
          type: "plain",
          channel: "generic",
        }),
      })
    )
  })

  it("returns failure status when Termii API returns an HTTP error status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Invalid phone number",
    })

    const provider = new TermiiSmsProvider(mockEnv, { fetchImpl: fetchImpl as never })

    const result = await provider.sendSms({
      recipientPhone: "invalid",
      message: "Test message",
      reference: "ref-2",
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("Termii API returned HTTP status 400")
  })
})
