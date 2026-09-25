import { beforeEach, describe, expect, it, vi } from "vitest"

import { createClient } from "@/lib/supabase/server"
import {
  emailConfirmationRequired,
  emailSignupConfirmation,
  SignupServiceError,
} from "@/services/signup-service"

import { signupAction } from "./actions"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.7" })),
}))

vi.mock("@/lib/action-rate-limit", () => ({
  enforceActionRateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/env", () => ({
  getAppUrlEnv: vi.fn(() => ({
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  })),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  hashRateLimitKeyPart: (value: string) => `hash:${value}`,
  RateLimitError: class extends Error {},
}))

vi.mock("@/services/signup-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/signup-service")>()),
  emailConfirmationRequired: vi.fn(),
  emailSignupConfirmation: vi.fn(),
}))

describe("signing up", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("emails the confirmation through the app's own email and says to check it, leaving Supabase's mailer out", async () => {
    const signUp = vi.fn()
    vi.mocked(createClient).mockResolvedValue({ auth: { signUp } } as never)
    vi.mocked(emailConfirmationRequired).mockResolvedValue(true)

    await expect(signupAction(createSignupForm("new@example.com"))).rejects.toThrow("NEXT_REDIRECT:/signup?sent=1")
    expect(emailSignupConfirmation).toHaveBeenCalledWith({ email: "new@example.com", password: "correct-horse-battery-staple" })
    expect(signUp).not.toHaveBeenCalled()
  })

  it("shows why when the confirmation email can't go out", async () => {
    vi.mocked(emailConfirmationRequired).mockResolvedValue(true)
    vi.mocked(emailSignupConfirmation).mockRejectedValue(
      new SignupServiceError("We couldn't send the confirmation email. Try again.", 502)
    )

    await expect(signupAction(createSignupForm("new@example.com"))).rejects.toThrow(
      "NEXT_REDIRECT:/signup?error=We+couldn%27t+send+the+confirmation+email.+Try+again."
    )
  })

  it("starts straight away, by naming the workspace, where the project skips confirmation", async () => {
    const signUp = vi.fn(async () => ({ data: { session: { access_token: "session" }, user: { id: "user-1" } }, error: null }))
    vi.mocked(createClient).mockResolvedValue({ auth: { signUp } } as never)
    vi.mocked(emailConfirmationRequired).mockResolvedValue(false)

    await expect(signupAction(createSignupForm("new@example.com"))).rejects.toThrow("NEXT_REDIRECT:/welcome")
    expect(emailSignupConfirmation).not.toHaveBeenCalled()
  })
})

function createSignupForm(email: string): FormData {
  const formData = new FormData()
  formData.set("email", email)
  formData.set("password", "correct-horse-battery-staple")
  return formData
}
