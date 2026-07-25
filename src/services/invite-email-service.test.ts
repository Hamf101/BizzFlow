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

  it("sends an EmailJS email containing the encoded invite URL", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_o0h0qnp",
      EMAILJS_TEMPLATE_ID: "template_notifications",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_PRIVATE_KEY: "private-test-key",
      EMAILJS_REPLY_TO_EMAIL: "support@example.com",
      EMAILJS_TIMEOUT_MS: "2500",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("OK", { status: 200 })
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
        signal: expect.any(AbortSignal),
      })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).toMatchObject({
      service_id: "service_o0h0qnp",
      template_id: "template_notifications",
      user_id: "public-test-key",
      accessToken: "private-test-key",
    })
    const templateParams = body.template_params as Record<string, unknown>

    expect(templateParams).toMatchObject({
      to_email: "member@example.com",
      reply_to: "support@example.com",
      delivery_reference: "organization-invite/invite-123",
    })
    expect(String(templateParams.html)).toContain("North &amp; Co.")
    expect(String(templateParams.html)).toContain(
      "https://app.example.com/accept-invite/invite%20token"
    )
    expect(String(templateParams.html)).toContain("Accept invitation")
    expect(String(templateParams.html)).toContain("background-color:#171717")
  })

  it("returns a user-safe error when EmailJS rejects delivery", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_o0h0qnp",
      EMAILJS_TEMPLATE_ID: "template_notifications",
      EMAILJS_PUBLIC_KEY: "public-test-key",
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })))
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      sendInviteEmail({
        inviteId: "invite-123",
        organizationName: "North Co.",
        recipientEmail: "member@example.com",
        token: "invite-token",
      })
    ).rejects.toMatchObject({
      message: "Unable to send the invite email. Check the EmailJS configuration and try again.",
      statusCode: 502,
    } satisfies Partial<InviteEmailServiceError>)
  })

  it("does not expose transport details in errors or logs", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_o0h0qnp",
      EMAILJS_TEMPLATE_ID: "template_notifications",
      EMAILJS_PUBLIC_KEY: "public-test-key",
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
  })
})
