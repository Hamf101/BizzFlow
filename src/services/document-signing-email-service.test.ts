import { createHash } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DocumentSigningEmailServiceError,
  sendDocumentSigningEmail,
} from "@/services/document-signing-email-service"

const originalEnv = { ...process.env }

describe("document signing email service", () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("sends an escaped document email with the encoded private link", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      EMAILJS_SERVICE_ID: "service_buy2dql",
      EMAILJS_TEMPLATE_ID: "template_d6o6c8p",
      EMAILJS_PUBLIC_KEY: "public-test-key",
      EMAILJS_PRIVATE_KEY: "private-test-key",
      EMAIL_TIMEOUT_MS: "2500",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "info").mockImplementation(() => {})

    await sendDocumentSigningEmail({
      documentId: "document-1",
      documentTitle: "Terms & Conditions",
      organizationName: "North & Co.",
      recipientEmail: "signer@example.com",
      recipientId: "recipient-1",
      recipientName: "Ada <Signer>",
      token: "private token",
    })

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as Record<string, unknown>

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.emailjs.com/api/v1.0/email/send",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
      })
    )
    expect(body).toMatchObject({
      service_id: "service_buy2dql",
      template_id: "template_d6o6c8p",
      user_id: "public-test-key",
      accessToken: "private-test-key",
    })
    const templateParams = body.template_params as Record<string, unknown>

    expect(templateParams).toMatchObject({
      to_email: "signer@example.com",
      delivery_reference: `document-signing/document-1/recipient-1/${createHash("sha256").update("private token", "utf8").digest("hex")}`,
    })
    expect(String(templateParams.message_html)).toContain("North &amp; Co.")
    expect(String(templateParams.message_html)).toContain("Ada &lt;Signer&gt;")
    expect(String(templateParams.message_html)).toContain(
      "https://app.example.com/sign/private%20token"
    )
    expect(String(templateParams.message_html)).toContain("Review document")
    expect(String(templateParams.message_html)).toContain("Do not forward this email.")
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
      sendDocumentSigningEmail({
        documentId: "document-1",
        documentTitle: "Agreement",
        organizationName: "North Co.",
        recipientEmail: "signer@example.com",
        recipientId: "recipient-1",
        recipientName: "Ada",
        token: "private-token",
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Unable to send the document email."),
      statusCode: 502,
    } satisfies Partial<DocumentSigningEmailServiceError>)
  })
})
