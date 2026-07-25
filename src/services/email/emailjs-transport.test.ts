import { describe, expect, it, vi } from "vitest"

import type { EmailJsEnv } from "@/lib/env"
import {
  EmailJsTransportError,
  sendEmailJsEmail,
  type SendEmailJsEmailInput,
} from "@/services/email/emailjs-transport"

const emailJsEnv: EmailJsEnv = {
  EMAILJS_SERVICE_ID: "service_o0h0qnp",
  EMAILJS_TEMPLATE_ID: "template_notifications",
  EMAILJS_PUBLIC_KEY: "public-test-key",
  EMAILJS_PRIVATE_KEY: "private-test-key",
  EMAILJS_REPLY_TO_EMAIL: "support@example.com",
  EMAILJS_TIMEOUT_MS: 3200,
}

const delivery: SendEmailJsEmailInput = {
  deliveryReference: "organization-invite/invite-123",
  payload: {
    toEmail: "member@example.com",
    subject: "Invitation",
    html: "<p>Invitation</p>",
    text: "Invitation",
    replyTo: "support@example.com",
  },
}

describe("EmailJS transport", () => {
  it("sends the documented EmailJS request with an injected timeout signal", async () => {
    const timeoutSignal = new AbortController().signal
    const createTimeoutSignal = vi.fn((): AbortSignal => timeoutSignal)
    const reserveSendSlot = vi.fn(async (): Promise<void> => {})
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response("OK", { status: 200 })
    )

    await expect(
      sendEmailJsEmail(delivery, emailJsEnv, {
        fetcher,
        createTimeoutSignal,
        reserveSendSlot,
      })
    ).resolves.toEqual({ providerStatus: 200 })

    expect(createTimeoutSignal).toHaveBeenCalledWith(3200)
    expect(reserveSendSlot).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.emailjs.com/api/v1.0/email/send",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_id: "service_o0h0qnp",
          template_id: "template_notifications",
          user_id: "public-test-key",
          accessToken: "private-test-key",
          template_params: {
            to_email: "member@example.com",
            subject: "Invitation",
            html: "<p>Invitation</p>",
            text: "Invitation",
            reply_to: "support@example.com",
            delivery_reference: "organization-invite/invite-123",
          },
        }),
        signal: timeoutSignal,
      })
    )
  })

  it("omits the optional private key and reply address when absent", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response("OK", { status: 200 })
    )

    await sendEmailJsEmail(
      {
        ...delivery,
        payload: { ...delivery.payload, replyTo: undefined },
      },
      { ...emailJsEnv, EMAILJS_PRIVATE_KEY: undefined },
      { fetcher, reserveSendSlot: async (): Promise<void> => {} }
    )

    const request = fetcher.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).not.toHaveProperty("accessToken")
    expect(body.template_params).toMatchObject({ reply_to: "" })
  })

  it("normalizes provider rejections without retaining response content", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response("sensitive provider detail", { status: 422 })
    )

    await expect(
      sendEmailJsEmail(delivery, emailJsEnv, {
        fetcher,
        reserveSendSlot: async (): Promise<void> => {},
      })
    ).rejects.toMatchObject({
      kind: "provider_rejected",
      providerStatus: 422,
      message: "EmailJS delivery failed.",
    } satisfies Partial<EmailJsTransportError>)
  })

  it.each(["", "invalid\nreference", "invité/123", "x".repeat(257)])(
    "rejects invalid delivery reference %j before making a request",
    async (deliveryReference: string) => {
      const fetcher = vi.fn<typeof fetch>()

      await expect(
        sendEmailJsEmail(
          { ...delivery, deliveryReference },
          emailJsEnv,
          { fetcher, reserveSendSlot: async (): Promise<void> => {} }
        )
      ).rejects.toMatchObject({
        kind: "invalid_delivery_reference",
        providerStatus: null,
      } satisfies Partial<EmailJsTransportError>)
      expect(fetcher).not.toHaveBeenCalled()
    }
  )
})
