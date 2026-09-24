import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import {
  createOrganization,
  getCurrentOrganizationContext,
  OrganizationServiceError,
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
    const formData = new FormData()
    formData.set("name", "Acme")

    await expect(createOrganizationAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=organization_created"
    )
    expect(createOrganization).toHaveBeenCalledExactlyOnceWith({
      userId: USER_ID,
      userEmail: "owner@example.com",
      name: "Acme",
    })
  })

  it("maps service copy to a fixed conflict outcome", async () => {
    vi.mocked(createOrganization).mockRejectedValue(
      new OrganizationServiceError("Private duplicate organization detail", 409)
    )

    await expect(createOrganizationAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard?feedback=refresh_required"
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Private+duplicate")
    )
  })

  it("preserves the dashboard login return path", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(createOrganizationAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fdashboard"
    )
  })
})

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
