import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getInvitePreview } from "@/services/organization-service"

import { signupAction } from "./actions"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("@/services/organization-service", () => ({
  getInvitePreview: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/env", () => ({
  getAppUrlEnv: vi.fn(() => ({
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  })),
}))

describe("signup invite validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("preserves the invite token when the signup email does not match", async () => {
    vi.mocked(getInvitePreview).mockResolvedValue({
      id: "invite-1",
      organizationName: "Acme",
      email: "invited@example.com",
      role: "staff",
      expiresAt: "2026-07-24T12:00:00.000Z",
    })

    await expect(
      signupAction(
        createSignupForm("different@example.com", "invite-token")
      )
    ).rejects.toThrow(
      "NEXT_REDIRECT:/signup?invite=invite-token&error=Create+your+account+with+the+email+address+on+the+invite."
    )
  })

  it("uses the unavailable message only when invite lookup fails", async () => {
    vi.mocked(getInvitePreview).mockRejectedValue(new Error("Invite expired"))
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      signupAction(createSignupForm("invited@example.com", "expired-token"))
    ).rejects.toThrow(
      "NEXT_REDIRECT:/signup?error=This+invite+is+no+longer+available."
    )
  })
})

function createSignupForm(email: string, inviteToken: string): FormData {
  const formData = new FormData()
  formData.set("email", email)
  formData.set("password", "correct-horse-battery-staple")
  formData.set("inviteToken", inviteToken)
  return formData
}
