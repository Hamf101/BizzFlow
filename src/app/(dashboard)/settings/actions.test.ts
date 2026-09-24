import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { updateOrganizationNotificationSettings } from "@/services/notification-service"
import {
  archiveOrganizationRole,
  createOrganizationRole,
  OrganizationServiceError,
  updateOrganizationRole,
  updateProfile,
  updateNotificationPreferences,
} from "@/services/organization-service"

import {
  archiveOrganizationRoleAction,
  createOrganizationRoleAction,
  updateNotificationPreferencesAction,
  updateOrganizationNotificationSettingsAction,
  updateOrganizationRoleAction,
  updateProfileAction,
} from "./actions"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}))

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", () => ({
  archiveOrganizationRole: vi.fn().mockResolvedValue(undefined),
  createOrganizationRole: vi.fn().mockResolvedValue(undefined),
  updateProfile: vi.fn().mockResolvedValue(undefined),
  updateNotificationPreferences: vi.fn().mockResolvedValue(undefined),
  updateOrganizationRole: vi.fn().mockResolvedValue(undefined),
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
const ROLE_ID = "50000000-0000-4000-8000-000000000001"

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

describe("organization role actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: USER_ID,
      email: "owner@example.com",
    } as never)
  })

  it("creates a custom role from the selected permission outcomes", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("name", "Billing assistant")
    formData.append("permissions", "people:view")
    formData.append("permissions", "documents:view")

    await expect(createOrganizationRoleAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=role_created#roles-and-access"
    )
    expect(createOrganizationRole).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      name: "Billing assistant",
      permissions: ["people:view", "documents:view"],
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings")
    expect(revalidatePathMock).toHaveBeenCalledWith("/people")
  })

  it("updates an editable starter role name and permissions", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("roleId", ROLE_ID)
    formData.set("name", "Operations lead")
    formData.append("permissions", "people:view")
    formData.append("permissions", "members:invite")

    await expect(updateOrganizationRoleAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=role_updated#roles-and-access"
    )
    expect(updateOrganizationRole).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      roleId: ROLE_ID,
      name: "Operations lead",
      permissions: ["people:view", "members:invite"],
    })
  })

  it("updates only the visible name when Owner access is locked", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("roleId", ROLE_ID)
    formData.set("name", "Workspace owner")
    formData.set("permissionsLocked", "true")

    await expect(updateOrganizationRoleAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=role_updated#roles-and-access"
    )
    expect(updateOrganizationRole).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      roleId: ROLE_ID,
      name: "Workspace owner",
      permissions: undefined,
    })
  })

  it("removes an unused non-owner role through the tenant service", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("roleId", ROLE_ID)

    await expect(archiveOrganizationRoleAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=role_removed#roles-and-access"
    )
    expect(archiveOrganizationRole).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORG_ID,
      roleId: ROLE_ID,
    })
  })

  it("explains when a role must be reassigned before removal", async () => {
    vi.mocked(archiveOrganizationRole).mockRejectedValue(
      new OrganizationServiceError("Role is still assigned.", 409)
    )
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("roleId", ROLE_ID)

    await expect(archiveOrganizationRoleAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/settings?feedback=role_in_use#roles-and-access"
    )
  })
})
