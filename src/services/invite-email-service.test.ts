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

  it("sends a Resend email containing the encoded invite URL", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
      RESEND_REPLY_TO_EMAIL: "support@example.com",
      RESEND_TIMEOUT_MS: "2500",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), { status: 200 })
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
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
          "Idempotency-Key": "organization-invite/invite-123",
        }),
        signal: expect.any(AbortSignal),
      })
    )
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(body).toMatchObject({
      from: "BizFlow Docs <noreply@example.com>",
      to: ["member@example.com"],
      reply_to: "support@example.com",
    })
    expect(String(body.html)).toContain("North &amp; Co.")
    expect(String(body.html)).toContain(
      "https://app.example.com/accept-invite/invite%20token"
    )
  })

  it("returns a user-safe error when Resend rejects delivery", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
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
      message: "Unable to send the invite email. Check the configured sender and try again.",
      statusCode: 502,
    } satisfies Partial<InviteEmailServiceError>)
  })

  it("does not expose transport details in errors or logs", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      RESEND_API_KEY: "re_test_key",
      RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
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
