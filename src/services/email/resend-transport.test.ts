import { describe, expect, it, vi } from "vitest"

import type { ResendEnv } from "@/lib/env"
import {
  EmailTransportError,
  sendResendEmail,
  type SendEmailInput,
} from "@/services/email/resend-transport"

const environment: ResendEnv = {
  RESEND_API_KEY: "re-test-key",
  RESEND_FROM_EMAIL: "docs@example.com",
  RESEND_TIMEOUT_MS: 2500,
}

function createInput(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    deliveryReference: "organization-invite/invite-1",
    payload: {
      toEmail: "member@example.com",
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    },
    ...overrides,
  }
}

describe("sendResendEmail", () => {
  it("posts the Resend message body and returns the email id", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    )
    const createTimeoutSignal = vi.fn(
      (): AbortSignal => AbortSignal.timeout(60000)
    )

    const result = await sendResendEmail(
      createInput({
        payload: {
          toEmail: "member@example.com",
          subject: "Subject",
          html: "<p>Hello</p>",
          text: "Hello",
          replyTo: "support@example.com",
        },
      }),
      environment,
      { fetcher, createTimeoutSignal }
    )

    expect(result).toEqual({
      providerStatus: 200,
      providerMessageId: "email-1",
    })
    expect(createTimeoutSignal).toHaveBeenCalledWith(2500)

    const [endpoint, request] = fetcher.mock.calls[0] as [string, RequestInit]

    expect(endpoint).toBe("https://api.resend.com/emails")
    expect(request.headers).toMatchObject({
      Authorization: "Bearer re-test-key",
      "Content-Type": "application/json",
      "Idempotency-Key": "organization-invite/invite-1",
    })
    expect(JSON.parse(String(request.body))).toEqual({
      from: "docs@example.com",
      to: ["member@example.com"],
      subject: "Subject",
      html: "<p>Hello</p>",
      text: "Hello",
      reply_to: "support@example.com",
    })
  })

  it("tolerates a success response without a readable email id", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }))

    const result = await sendResendEmail(createInput(), environment, {
      fetcher,
    })

    expect(result).toEqual({ providerStatus: 200, providerMessageId: null })
  })

  it("throws provider_rejected with the status and never reads the error body", async () => {
    const errorBody = vi.fn()
    const response = new Response(JSON.stringify({ message: "secret detail" }), {
      status: 422,
    })
    vi.spyOn(response, "json").mockImplementation(errorBody)
    vi.spyOn(response, "text").mockImplementation(errorBody)
    const fetcher = vi.fn().mockResolvedValue(response)

    await expect(
      sendResendEmail(createInput(), environment, { fetcher })
    ).rejects.toMatchObject({
      kind: "provider_rejected",
      providerStatus: 422,
      message: "Email delivery failed.",
    } satisfies Partial<EmailTransportError>)
    expect(errorBody).not.toHaveBeenCalled()
  })

  it("flattens network failures into request_failed without the cause", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error("sensitive network detail"))

    await expect(
      sendResendEmail(createInput(), environment, { fetcher })
    ).rejects.toMatchObject({
      kind: "request_failed",
      providerStatus: null,
      message: "Email delivery failed.",
    } satisfies Partial<EmailTransportError>)
  })

  it.each([
    ["an empty reference", ""],
    ["an overlong reference", "r".repeat(257)],
    ["a non-printable reference", "line\nbreak"],
  ])("rejects %s before any network call", async (_label, reference) => {
    const fetcher = vi.fn()

    await expect(
      sendResendEmail(
        createInput({ deliveryReference: reference }),
        environment,
        { fetcher }
      )
    ).rejects.toMatchObject({
      kind: "invalid_delivery_reference",
    } satisfies Partial<EmailTransportError>)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
