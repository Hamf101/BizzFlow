import { afterEach, describe, expect, it, vi } from "vitest"

import {
  InviteEmailServiceError,
  sendInviteEmail,
} from "@/services/invite-email-service"

const originalEnv = { ...process.env }

describe("invite email service", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("sends an EmailJS message containing the branded encoded invite URL", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAIL_PROVIDER: "emailjs",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_PRIVATE_KEY: "private-test-key",
      EMAIL_TIMEOUT_MS: "2500",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-9" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendInviteEmail({
      inviteId: "invite-123",
      organizationName: "North & Co.",
      recipientEmail: "member@example.com",
      token: "invite token",
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.emailjs.com/api/v1.0/email/send",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
      })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).toMatchObject({
      service_id: "service_buy2dql",
      template_id: "template_d6o6c8p",
      user_id: "public-test-key",
      accessToken: "private-test-key",
    })
    const templateParams = body.template_params as Record<string, unknown>

    expect(templateParams).not.toHaveProperty("reply_to")
    expect(String(templateParams.message_html)).toContain("North &amp; Co.")
    expect(String(templateParams.message_html)).toContain(
      "https://app.example.com/accept-invite/invite%20token"
    )
    expect(String(templateParams.message_html)).toContain("Accept invitation")
    expect(String(templateParams.message_html)).toContain(
      "background-color:#635273"
    )
    expect(String(templateParams.message_html)).toContain("<!doctype html>")
    expect(String(templateParams.message_html)).toContain(
      "Sent securely by BizFlow Docs."
    )
  })

  it("returns a user-safe error when EmailJS rejects delivery", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 400 }))
    )
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendInviteEmail({
        inviteId: "invite-123",
        organizationName: "North Co.",
        recipientEmail: "member@example.com",
        token: "invite-token",
      })
    ).rejects.toMatchObject({
      message:
        "Unable to send the invite email. EmailJS rejected the message. " +
        "Check the service, template fields, and recipient address.",
      statusCode: 502,
    } satisfies Partial<InviteEmailServiceError>)
  })

  it("names the account-key cause when EmailJS refuses the request", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_PRIVATE_KEY: "private-test-key",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    )
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendInviteEmail({
        inviteId: "invite-123",
        organizationName: "North Co.",
        recipientEmail: "member@example.com",
        token: "invite-token",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("public and private account keys"),
      statusCode: 502,
    })
  })

  it("does not expose transport details in errors or logs", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_PRIVATE_KEY: "private-test-key",
    }
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("sensitive provider network detail"))
    )

    await expect(
      sendInviteEmail({
        inviteId: "invite-123",
        organizationName: "North Co.",
        recipientEmail: "member@example.com",
        token: "private-invite-token",
      })
    ).rejects.toMatchObject({
      message: "Unable to send the invite email. Try again shortly.",
      statusCode: 502,
    } satisfies Partial<InviteEmailServiceError>)

    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "sensitive provider network detail"
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "private-invite-token"
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private-test-key")
  })
})
