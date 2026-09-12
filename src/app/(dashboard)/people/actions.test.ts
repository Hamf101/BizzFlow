import { beforeEach, describe, expect, it, vi } from "vitest"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  createInvite,
  revokeInvite,
  updateMemberAccess,
  updateProfilePhone,
} from "@/services/organization-service"

import {
  createInviteAction,
  revokeInviteAction,
  updateMemberAccessAction,
  updateProfilePhoneAction,
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

vi.mock("@/lib/page-auth", () => ({
  loadAuthenticatedPageUser: vi.fn(),
}))

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return { ...actual, getAuthenticatedUser: vi.fn() }
})

vi.mock("@/lib/action-rate-limit", () => ({
  enforceOutboundEmailRateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/organization-service", () => ({
  createInvite: vi.fn().mockResolvedValue({
    invite: { id: "invite-1", token: "invite-token" },
    emailDelivered: true,
    emailFailureReason: null,
  }),
  OrganizationServiceError: class extends Error {
    readonly statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  },
  revokeInvite: vi.fn(),
  updateMemberAccess: vi.fn(),
  updateProfilePhone: vi.fn(),
}))

const MEMBER_ID = "20000000-0000-4000-8000-000000000001"
const ORG_ID = "10000000-0000-4000-8000-000000000001"
const ROLE_ID = "50000000-0000-4000-8000-000000000001"
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000002"

function createInviteForm(): FormData {
  const formData = new FormData()
  formData.set("organizationId", ORG_ID)
  formData.set("roleDefinitionId", ROLE_ID)
  formData.set("email", "invitee@example.com")
  return formData
}

describe("createInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadAuthenticatedPageUser).mockResolvedValue({
      id: MEMBER_ID,
      email: "member@example.com",
    } as never)
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: MEMBER_ID,
      email: "member@example.com",
    } as never)
    vi.mocked(enforceOutboundEmailRateLimit).mockResolvedValue(undefined)
    vi.mocked(createInvite).mockResolvedValue({
      invite: { id: "invite-1", token: "invite-token" },
      emailDelivered: true,
      emailFailureReason: null,
    } as never)
  })

  it("enforces the outbound email budget for the authenticated member", async () => {
    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=invite_email_sent"
    )

    expect(loadAuthenticatedPageUser).toHaveBeenCalledExactlyOnceWith("/people")
    expect(enforceOutboundEmailRateLimit).toHaveBeenCalledExactlyOnceWith({
      userId: MEMBER_ID,
      redirectPath: "/people",
    })
    expect(createInvite).toHaveBeenCalledExactlyOnceWith({
      actorUserId: MEMBER_ID,
      organizationId: ORG_ID,
      roleId: ROLE_ID,
      email: "invitee@example.com",
    })
  })

  it("keeps the invite and says so when the email could not be sent", async () => {
    // A misconfigured email provider must not look like a broken invite: the
    // token is still valid, so the manager is told to share the link instead.
    vi.mocked(createInvite).mockResolvedValue({
      invite: { id: "invite-1", token: "invite-token" },
      emailDelivered: false,
      emailFailureReason: "The email provider refused the request.",
    } as never)

    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=invite_created_email_failed"
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("provider+refused")
    )
  })

  it("throttles before the invite is created", async () => {
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error("NEXT_REDIRECT:/people?feedback=retry_later")
      }
    )

    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=retry_later"
    )
    expect(createInvite).not.toHaveBeenCalled()
  })

  it("does not flatten a throttle redirect into the generic invite error", async () => {
    // Regression guard: the limiter must stay outside the try/catch, otherwise
    // the redirect (which signals by throwing) is swallowed and re-reported as
    // "Unable to create invite."
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error("NEXT_REDIRECT:/people?feedback=retry_later")
      }
    )

    await expect(createInviteAction(createInviteForm())).rejects.not.toThrow(
      /feedback=operation_failed/
    )
  })

  it("keeps an invalid role id from reaching authentication or the limiter", async () => {
    const formData = createInviteForm()
    formData.set("roleDefinitionId", "not-a-role-id")

    await expect(createInviteAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=invalid_input"
    )
    expect(loadAuthenticatedPageUser).not.toHaveBeenCalled()
    expect(enforceOutboundEmailRateLimit).not.toHaveBeenCalled()
  })

  it("maps invite service copy to a fixed failure code", async () => {
    vi.mocked(createInvite).mockRejectedValue(
      new Error("EmailJS request id and provider diagnostics")
    )

    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=operation_failed"
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("EmailJS")
    )
  })
})

describe("people profile and permission actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: MEMBER_ID,
      email: "member@example.com",
    } as never)
    vi.mocked(updateMemberAccess).mockResolvedValue(undefined as never)
    vi.mocked(revokeInvite).mockResolvedValue(undefined as never)
    vi.mocked(updateProfilePhone).mockResolvedValue(undefined as never)
  })

  it("updates a workspace name and custom role as one authoritative change", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("membershipId", MEMBERSHIP_ID)
    formData.set("roleDefinitionId", ROLE_ID)
    formData.set("workspaceDisplayName", "Avery Kim")

    await expect(updateMemberAccessAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=member_access_updated"
    )
    expect(updateMemberAccess).toHaveBeenCalledExactlyOnceWith({
      actorUserId: MEMBER_ID,
      organizationId: ORG_ID,
      membershipId: MEMBERSHIP_ID,
      roleId: ROLE_ID,
      workspaceDisplayName: "Avery Kim",
    })
    expect(revalidatePathMock).toHaveBeenCalledWith("/people")
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings")
  })

  it("rejects an invalid member role id before authentication", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("membershipId", MEMBERSHIP_ID)
    formData.set("roleDefinitionId", "sysadmin")

    await expect(updateMemberAccessAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=invalid_input"
    )
    expect(getAuthenticatedUser).not.toHaveBeenCalled()
    expect(updateMemberAccess).not.toHaveBeenCalled()
  })

  it("updates the authenticated member phone without trusting a submitted user id", async () => {
    const formData = new FormData()
    formData.set("phoneNumber", "+14155552671")

    await expect(updateProfilePhoneAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=changes_saved"
    )
    expect(updateProfilePhone).toHaveBeenCalledExactlyOnceWith({
      actorUserId: MEMBER_ID,
      phoneNumber: "+14155552671",
    })
  })

  it("revokes a tenant-scoped invite using the authenticated actor", async () => {
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("inviteId", "invite-2")

    await expect(revokeInviteAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?feedback=invite_deleted"
    )
    expect(revokeInvite).toHaveBeenCalledExactlyOnceWith({
      actorUserId: MEMBER_ID,
      organizationId: ORG_ID,
      inviteId: "invite-2",
    })
  })

  it("preserves the People return path when authentication expires", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )
    const formData = new FormData()
    formData.set("organizationId", ORG_ID)
    formData.set("membershipId", MEMBERSHIP_ID)
    formData.set("roleDefinitionId", ROLE_ID)

    await expect(updateMemberAccessAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fpeople"
    )
    expect(updateMemberAccess).not.toHaveBeenCalled()
  })
})
