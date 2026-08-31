import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { getCurrentOrganizationContext } from "@/services/organization-service"
import {
  createPublicFormLink,
  disablePublicFormLink,
} from "@/services/public-form-service"

import {
  createPublicFormLinkAction,
  disablePublicFormLinkAction,
} from "./public-link-actions"

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

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(),
}))

vi.mock("@/services/public-form-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/public-form-service")>()
  return {
    ...actual,
    createPublicFormLink: vi.fn(),
    disablePublicFormLink: vi.fn(),
  }
})

const USER_ID = "20000000-0000-4000-8000-000000000001"
const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001"
const TEMPLATE_ID = "30000000-0000-4000-8000-000000000001"
const LINK_ID = "40000000-0000-4000-8000-000000000001"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    id: USER_ID,
    email: "manager@example.com",
  })
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
      role: "manager",
      status: "active",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
  })
  vi.mocked(createPublicFormLink).mockResolvedValue(undefined as never)
  vi.mocked(disablePublicFormLink).mockResolvedValue(undefined as never)
})

describe("public form link actions", () => {
  it("creates a link before reporting its stable outcome", async () => {
    const formData = new FormData()
    formData.set("templateId", TEMPLATE_ID)
    formData.set("expiresAt", "2026-12-31T12:00:00.000Z")
    formData.set("maxSubmissions", "12")

    await expect(createPublicFormLinkAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/templates?feedback=public_link_created"
    )
    expect(createPublicFormLink).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORGANIZATION_ID,
      templateId: TEMPLATE_ID,
      expiresAt: "2026-12-31T12:00:00.000Z",
      maxSubmissions: 12,
    })
    expect(revalidatePathMock).toHaveBeenCalledExactlyOnceWith("/templates")
  })

  it("disables a link before reporting its stable outcome", async () => {
    const formData = new FormData()
    formData.set("linkId", LINK_ID)

    await expect(disablePublicFormLinkAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/templates?feedback=public_link_disabled"
    )
    expect(disablePublicFormLink).toHaveBeenCalledExactlyOnceWith({
      actorUserId: USER_ID,
      organizationId: ORGANIZATION_ID,
      linkId: LINK_ID,
    })
  })

  it("rejects a member without management permission before the service", async () => {
    vi.mocked(getCurrentOrganizationContext).mockResolvedValue({
      organization: { id: ORGANIZATION_ID },
      membership: { role: "staff" },
    } as never)

    await expect(createPublicFormLinkAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/templates?feedback=permission_denied"
    )
    expect(createPublicFormLink).not.toHaveBeenCalled()
  })

  it("does not reflect service diagnostics into the destination", async () => {
    vi.mocked(createPublicFormLink).mockRejectedValue(
      new Error("private public-link persistence detail")
    )

    await expect(createPublicFormLinkAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/templates?feedback=operation_failed"
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("private+public-link")
    )
  })

  it("preserves the template library login return path", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )

    await expect(disablePublicFormLinkAction(new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Ftemplates"
    )
  })
})
