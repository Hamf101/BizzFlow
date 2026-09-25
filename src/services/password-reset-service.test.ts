import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { type EmailTransport, EmailTransportError } from "@/services/email/contracts"
import { sendPasswordResetEmail } from "@/services/password-reset-service"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    EMAILJS_SERVICE_ID: "service_reset",
    EMAILJS_TEMPLATE_ID: "template_reset",
    EMAILJS_PUBLIC_KEY: "public-test-key",
    EMAIL_TIMEOUT_MS: "2500",
  }
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

function adminWith(result: unknown) {
  const generateLink = vi.fn(async () => result)

  return { client: { auth: { admin: { generateLink } } } as never, generateLink }
}

const ACCOUNT = { data: { properties: { hashed_token: "hashed-token-1" }, user: { id: "user-1" } }, error: null }

it("emails an account's owner a link to the new-password page carrying its one-time token", async () => {
  const { client, generateLink } = adminWith(ACCOUNT)
  const transport = vi.fn<EmailTransport>(async () => ({ providerStatus: 200, providerMessageId: null }))

  await sendPasswordResetEmail({ email: "owner@example.com" }, { client, transport })

  expect(generateLink).toHaveBeenCalledWith({ type: "recovery", email: "owner@example.com" })
  expect(transport).toHaveBeenCalledOnce()
  const payload = transport.mock.calls[0]?.[0].payload
  expect(payload?.toEmail).toBe("owner@example.com")
  expect(payload?.html).toContain("https://app.example.com/reset-password?token_hash=hashed-token-1")
  expect(payload?.text).toContain("https://app.example.com/reset-password?token_hash=hashed-token-1")
})

it("sends nothing for an address without an account, and finishes just the same", async () => {
  const { client } = adminWith({ data: { properties: null, user: null }, error: { code: "user_not_found", status: 404 } })
  const transport = vi.fn<EmailTransport>()

  await expect(sendPasswordResetEmail({ email: "nobody@example.com" }, { client, transport })).resolves.toBeUndefined()
  expect(transport).not.toHaveBeenCalled()
})

it("keeps a failed delivery from the visitor, who is told the same either way", async () => {
  const { client } = adminWith(ACCOUNT)
  const transport = vi.fn<EmailTransport>(async () => {
    throw new EmailTransportError("provider_rejected", 400)
  })

  await expect(sendPasswordResetEmail({ email: "owner@example.com" }, { client, transport })).resolves.toBeUndefined()
})
