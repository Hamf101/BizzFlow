import { describe, expect, it, vi } from "vitest"

import type { ResendEnv } from "@/lib/env"
import {
  ResendTransportError,
  sendResendEmail,
  type SendResendEmailInput,
} from "@/services/email/resend-transport"

const resendEnv: ResendEnv = {
  RESEND_API_KEY: "resend-test-key",
  RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
  RESEND_REPLY_TO_EMAIL: "support@example.com",
  RESEND_TIMEOUT_MS: 3200,
}

const delivery: SendResendEmailInput = {
  logicalDeliveryId: "organization-invite/invite-123",
  payload: {
    from: "BizFlow Docs <noreply@example.com>",
    to: ["member@example.com"],
    subject: "Invitation",
    html: "<p>Invitation</p>",
    text: "Invitation",
    reply_to: "support@example.com",
  },
}

describe("Resend transport", () => {
  it("sends the official idempotency header with an injected timeout signal", async () => {
    const timeoutSignal = new AbortController().signal
    const createTimeoutSignal = vi.fn((): AbortSignal => timeoutSignal)
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ id: "email-123" }), { status: 200 })
    )

    await expect(
      sendResendEmail(delivery, resendEnv, {
        fetcher,
        createTimeoutSignal,
      })
    ).resolves.toEqual({ emailId: "email-123" })

    expect(createTimeoutSignal).toHaveBeenCalledWith(3200)
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer resend-test-key",
          "Content-Type": "application/json",
          "Idempotency-Key": "organization-invite/invite-123",
        },
        body: JSON.stringify(delivery.payload),
        signal: timeoutSignal,
      })
    )
  })

  it("normalizes provider rejections without retaining response content", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ message: "sensitive provider detail" }), {
        status: 422,
      })
    )

    await expect(
      sendResendEmail(delivery, resendEnv, { fetcher })
    ).rejects.toMatchObject({
      kind: "provider_rejected",
      providerStatus: 422,
      message: "Resend email delivery failed.",
    } satisfies Partial<ResendTransportError>)
  })

  it.each(["", "invalid\nkey", "invité/123", "x".repeat(257)])(
    "rejects invalid logical delivery ID %j before making a request",
    async (logicalDeliveryId: string) => {
      const fetcher = vi.fn<typeof fetch>()

      await expect(
        sendResendEmail(
          {
            ...delivery,
            logicalDeliveryId,
          },
          resendEnv,
          { fetcher }
        )
      ).rejects.toMatchObject({
        kind: "invalid_delivery_id",
        providerStatus: null,
      } satisfies Partial<ResendTransportError>)
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
})
