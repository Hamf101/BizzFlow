import { beforeEach, describe, expect, it, vi } from "vitest"

import { getAuthenticatedUser } from "@/lib/auth"
import { updateProfile, updateNotificationPreferences } from "@/services/organization-service"

import { updateProfileAction, updateNotificationPreferencesAction } from "./actions"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getAuthenticatedUser: vi.fn(),
}))

vi.mock("@/services/organization-service", () => ({
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
  OrganizationServiceError: class extends Error {},
}))

const USER_ID = "20000000-0000-4000-8000-000000000001"
const ORG_ID = "10000000-0000-4000-8000-000000000001"

describe("updateProfileAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    } as never)
  })

  it("calls updateProfile with the right arguments and redirects to settings on success", async () => {
    const formData = new FormData()
    formData.set("displayName", "Jane Doe")
    formData.set("phoneNumber", "+14155552671")

    await expect(updateProfileAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?message=Profile+updated."
    )

    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      displayName: "Jane Doe",
      phoneNumber: "+14155552671",
    })
  })
})

describe("updateNotificationPreferencesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    } as never)
  })

  it("calls updateNotificationPreferences with correct columns based on form checkboxes", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("emailNotificationsEnabled", "on")
    // Note: smsNotificationsEnabled is left out to simulate unchecked

    await expect(updateNotificationPreferencesAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?message=Notification+preferences+updated."
    )

    expect(updateNotificationPreferences).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
    })
  })
})
