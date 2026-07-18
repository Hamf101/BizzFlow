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
      RESEND_API_KEY: "resend-test-key",
      RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
      RESEND_TIMEOUT_MS: "2500",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-123" }), { status: 200 })
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
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": `document-signing/document-1/recipient-1/${createHash("sha256").update("private token", "utf8").digest("hex")}`,
        }),
        signal: expect.any(AbortSignal),
      })
    )
    expect(String(body.html)).toContain("North &amp; Co.")
    expect(String(body.html)).toContain("Ada &lt;Signer&gt;")
    expect(String(body.html)).toContain(
      "https://app.example.com/sign/private%20token"
    )
  })

  it("returns a user-safe error when Resend rejects delivery", async () => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://app.example.com",
      RESEND_API_KEY: "resend-test-key",
      RESEND_FROM_EMAIL: "BizFlow Docs <noreply@example.com>",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 422 }))
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
      message:
        "Unable to send the document email. Check the configured sender and try again.",
      statusCode: 502,
    } satisfies Partial<DocumentSigningEmailServiceError>)
  })
})
