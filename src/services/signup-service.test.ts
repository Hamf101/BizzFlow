import { afterEach, describe, expect, it, vi } from "vitest"

import { emailConfirmationRequired, emailSignupConfirmation } from "@/services/signup-service"

vi.mock("@/lib/env", () => ({
  getAppUrlEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://app.example.com" }),
  getEmailEnv: () => ({ EMAIL_REPLY_TO_EMAIL: undefined }),
  getPublicSupabaseEnv: () => ({ SUPABASE_PUBLISHABLE_KEY: "publishable", SUPABASE_URL: "https://project.supabase.co" }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function signupClient(result: { error: { code: string } | null }) {
  const generateLink = vi.fn(async () => ({
    data: result.error ? { properties: null, user: null } : { properties: { hashed_token: "hashed-123", verification_type: "signup" }, user: { id: "user-1" } },
    error: result.error,
  }))

  return { client: { auth: { admin: { generateLink } } } as never, generateLink }
}

describe("confirming a new account's address", () => {
  it("emails the confirmation link through the app's own email, not Supabase's", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client, generateLink } = signupClient({ error: null })
    const transport = vi.fn(async () => ({ providerMessageId: null, providerStatus: 200 }))

    await emailSignupConfirmation({ email: "new@example.com", password: "long-enough-secret" }, { client, transport })

    expect(generateLink).toHaveBeenCalledWith({ email: "new@example.com", password: "long-enough-secret", type: "signup" })
    const [{ payload }] = transport.mock.calls[0] as unknown as [{ payload: { html: string; text: string; toEmail: string } }]
    expect(payload.toEmail).toBe("new@example.com")
    expect(payload.text).toContain("https://app.example.com/confirm-email?token_hash=hashed-123&type=signup")
    expect(payload.html).toContain("https://app.example.com/confirm-email?token_hash=hashed-123&amp;type=signup")
  })

  it("sends nothing for an address that already has an account, and says nothing different", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const { client } = signupClient({ error: { code: "email_exists" } })
    const transport = vi.fn()

    await expect(
      emailSignupConfirmation({ email: "taken@example.com", password: "long-enough-secret" }, { client, transport })
    ).resolves.toBeUndefined()
    expect(transport).not.toHaveBeenCalled()
  })

  it("follows the project's own setting, and asks for confirmation when it can't tell", async () => {
    const settings = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)))
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })

    await expect(emailConfirmationRequired({ fetch: settings({ mailer_autoconfirm: false }) })).resolves.toBe(true)
    await expect(emailConfirmationRequired({ fetch: settings({ mailer_autoconfirm: true }) })).resolves.toBe(false)
    await expect(emailConfirmationRequired({ fetch: offline })).resolves.toBe(true)
  })
})
