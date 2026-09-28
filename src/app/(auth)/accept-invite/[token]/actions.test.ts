import { beforeEach, describe, expect, it, vi } from "vitest"

import { createClient } from "@/lib/supabase/server"
import {
  acceptInvite,
  createInvitedAccount,
  OrganizationServiceError,
  updateProfile,
} from "@/services/organization-service"

import { joinWithPasswordAction } from "./actions"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.7" })),
}))
vi.mock("@/lib/action-rate-limit", () => ({
  enforceActionRateLimit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/services/organization-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/organization-service")>()),
  acceptInvite: vi.fn(),
  createInvitedAccount: vi.fn(),
  updateProfile: vi.fn(),
}))

const USER_ID = "20000000-0000-4000-8000-000000000002"
const PASSWORD = "Correct-horse-battery-5taple"

describe("someone new joining through an invite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(createInvitedAccount).mockResolvedValue({ email: "sam@example.com", existing: false })
    vi.mocked(acceptInvite).mockResolvedValue(undefined as never)
    vi.mocked(updateProfile).mockResolvedValue(undefined)
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { user: { email: "sam@example.com", id: USER_ID } },
          error: null,
        }),
      },
    } as never)
  })

  it("saves the name and phone they typed, once they've joined", async () => {
    await expect(
      joinWithPasswordAction(joinForm({ displayName: " Sam Okafor ", phoneNumber: "+234 800 123 4567" }))
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard?feedback=invite_accepted")
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      displayName: "Sam Okafor",
      phoneNumber: "+2348001234567",
    })
    // Joining makes their profile row, so the name can only follow it.
    expect(vi.mocked(acceptInvite).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updateProfile).mock.invocationCallOrder[0] ?? 0
    )
  })

  it("opens no account for a phone number without its country code", async () => {
    await expect(joinWithPasswordAction(joinForm({ phoneNumber: "0800 123 4567" }))).rejects.toThrow(
      "NEXT_REDIRECT:/accept-invite/invite-token?error=Start+your+phone+number+with+%2B+and+the+country+code."
    )
    expect(createInvitedAccount).not.toHaveBeenCalled()
  })

  it("still lets them in when the name can't be saved, since Settings can take it later", async () => {
    vi.mocked(updateProfile).mockRejectedValue(new OrganizationServiceError("Unable to update profile.", 500))

    await expect(joinWithPasswordAction(joinForm())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=invite_accepted"
    )
  })
})

function joinForm(fields: Record<string, string> = {}): FormData {
  const formData = new FormData()
  const values = {
    account: "new",
    confirm: PASSWORD,
    displayName: "Sam Okafor",
    password: PASSWORD,
    phoneNumber: "",
    token: "invite-token",
    ...fields,
  }

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value)
  }

  return formData
}
