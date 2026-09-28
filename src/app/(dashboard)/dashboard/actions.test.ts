import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  createOrganization,
  getCurrentOrganizationContext,
  OrganizationServiceError,
  updateProfile,
} from "@/services/organization-service"
import {
  seedSampleSubmissionsForOrganization,
  seedStarterTemplatesForOrganization,
} from "@/services/templates/starter-templates"

import {
  createOrganizationAction,
  seedSampleSubmissionsAction,
  seedStarterTemplatesAction,
} from "./actions"

const { redirectMock, revalidatePathMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  revalidatePathMock: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/services/organization-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/organization-service")>()
  return {
    ...actual,
    createOrganization: vi.fn(),
    getCurrentOrganizationContext: vi.fn(),
    updateProfile: vi.fn(),
  }
})

vi.mock("@/services/templates/starter-templates", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/templates/starter-templates")
  >()
  return {
    ...actual,
    seedSampleSubmissionsForOrganization: vi.fn(),
    seedStarterTemplatesForOrganization: vi.fn(),
  }
})

const USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    id: USER_ID,
    email: "owner@example.com",
  })
  vi.mocked(createOrganization).mockResolvedValue(undefined as never)
  vi.mocked(updateProfile).mockResolvedValue(undefined)
  vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
    organization: {
      id: ORGANIZATION_ID,
      name: "Acme",
      slug: "acme",
      createdBy: USER_ID,
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
    membership: {
      id: "membership-1",
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      role: "owner_admin",
      status: "active",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
  })
  vi.mocked(seedStarterTemplatesForOrganization).mockResolvedValue({
    seededCount: 3,
    skippedCount: 0,
  })
  vi.mocked(seedSampleSubmissionsForOrganization).mockResolvedValue({
    seededCount: 2,
    skippedCount: 0,
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("createOrganizationAction", () => {
  it("creates an organization for the authenticated user before reporting success", async () => {
    await expect(createOrganizationAction(welcomeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=organization_created"
    )
    expect(createOrganization).toHaveBeenCalledExactlyOnceWith({
      userId: USER_ID,
      userEmail: "owner@example.com",
      name: "Acme",
    })
  })

  it("saves the owner's name and phone, written the way people write numbers, once the workspace exists", async () => {
    await expect(
      createOrganizationAction(welcomeForm({ displayName: "  Talora Reyes ", phoneNumber: "+44 (20) 7946-0958" }))
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard?feedback=organization_created")
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      displayName: "Talora Reyes",
      phoneNumber: "+442079460958",
    })
    // Their profile row is made with the workspace, so the name can only follow it.
    expect(vi.mocked(createOrganization).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(updateProfile).mock.invocationCallOrder[0] ?? 0
    )
  })

  it("asks again for a phone number without its country code, before making anything", async () => {
    await expect(createOrganizationAction(welcomeForm({ phoneNumber: "020 7946 0958" }))).rejects.toThrow(
      "NEXT_REDIRECT:/welcome?error=Start+your+phone+number+with+%2B+and+the+country+code."
    )
    expect(createOrganization).not.toHaveBeenCalled()
    expect(updateProfile).not.toHaveBeenCalled()
  })

  it("asks for the owner's name", async () => {
    await expect(createOrganizationAction(welcomeForm({ displayName: "  " }))).rejects.toThrow(
      "NEXT_REDIRECT:/welcome?error=Enter+your+name."
    )
    expect(createOrganization).not.toHaveBeenCalled()
  })

  it("still opens the new workspace when the name can't be saved, since Settings can take it later", async () => {
    vi.mocked(updateProfile).mockRejectedValue(new OrganizationServiceError("Unable to update profile.", 500))

    await expect(createOrganizationAction(welcomeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=organization_created"
    )
  })

  it("keeps service detail out of the address, and sends the person back to name their workspace", async () => {
    vi.mocked(createOrganization).mockRejectedValue(
      new OrganizationServiceError("Private duplicate organization detail", 409)
    )

    await expect(createOrganizationAction(welcomeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/welcome?error=Unable+to+create+the+workspace.+Try+again."
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Private+duplicate")
    )
  })

  it("shows the name rule where the name was typed", async () => {
    vi.mocked(createOrganization).mockRejectedValue(
      new OrganizationServiceError("Workspace name must be between 2 and 120 characters.", 400)
    )

    await expect(createOrganizationAction(welcomeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/welcome?error=Workspace+name+must+be+between+2+and+120+characters."
    )
  })

  it("returns to naming the workspace after logging in", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(createOrganizationAction(welcomeForm())).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fwelcome"
    )
  })
})

function welcomeForm(fields: Record<string, string> = {}): FormData {
  const formData = new FormData()

  for (const [key, value] of Object.entries({ displayName: "Talora Reyes", name: "Acme", phoneNumber: "", ...fields })) {
    formData.set(key, value)
  }

  return formData
}

describe("dashboard starter content actions", () => {
  it("adds starter templates for the authenticated organization", async () => {
    await expect(seedStarterTemplatesAction()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=starter_content_added"
    )
    expect(seedStarterTemplatesForOrganization).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it("adds sample submissions for the authenticated organization", async () => {
    await expect(seedSampleSubmissionsAction()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=sample_content_added"
    )
    expect(seedSampleSubmissionsForOrganization).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORGANIZATION_ID,
    })
  })

  it("fails closed when starter content has no organization context", async () => {
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue(null)

    await expect(seedStarterTemplatesAction()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=organization_required"
    )
  })
})
