import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { updateOrganizationNotificationSettings } from "@/services/notification-service"
import {
  OrganizationServiceError,
  updateProfile,
  updateNotificationPreferences,
} from "@/services/organization-service"

import {
  updateNotificationPreferencesAction,
  updateOrganizationNotificationSettingsAction,
  updateProfileAction,
} from "./actions"

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

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", () => ({
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
  OrganizationServiceError: class extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
}))

vi.mock("@/services/notification-service", () => ({
  updateOrganizationNotificationSettings: vi.fn().mockResolvedValue(undefined),
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
      "NEXT_REDIRECT:/settings?feedback=changes_saved"
    )

    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      displayName: "Jane Doe",
      phoneNumber: "+14155552671",
    })
  })

  it("uses a fixed validation code instead of reflecting schema copy", async () => {
    const formData = new FormData()
    formData.set("displayName", "")
    formData.set("phoneNumber", "not-a-phone")

    await expect(updateProfileAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=invalid_input"
    )
    expect(updateProfile).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("E.164")
    )
  })

  it("maps a permission rejection to fixed copy without exposing service details", async () => {
    vi.mocked(updateProfile).mockRejectedValue(
      new OrganizationServiceError("Private tenant permission detail", 403)
    )
    const formData = new FormData()
    formData.set("displayName", "Jane Doe")
    formData.set("phoneNumber", "")

    await expect(updateProfileAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=permission_denied"
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Private+tenant")
    )
  })

  it("preserves the Settings return path when authentication expires", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )
    const formData = new FormData()
    formData.set("displayName", "Jane Doe")
    formData.set("phoneNumber", "")

    await expect(updateProfileAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fsettings"
    )
    expect(updateProfile).not.toHaveBeenCalled()
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
      "NEXT_REDIRECT:/settings?feedback=changes_saved"
    )

    expect(updateNotificationPreferences).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
    })
  })
})

describe("updateOrganizationNotificationSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: USER_ID,
      email: "user@example.com",
    } as never)
    vi.mocked(updateOrganizationNotificationSettings).mockResolvedValue(
      undefined as never
    )
  })

  it("waits for the organization setting update before reporting saved", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("orgEmailNotificationsEnabled", "on")

    await expect(
      updateOrganizationNotificationSettingsAction(formData)
    ).rejects.toThrow("NEXT_REDIRECT:/settings?feedback=changes_saved")
    expect(updateOrganizationNotificationSettings).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: false,
    })
  })
})
