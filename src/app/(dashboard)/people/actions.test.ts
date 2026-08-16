import { beforeEach, describe, expect, it, vi } from "vitest"

import { enforceOutboundEmailRateLimit } from "@/lib/action-rate-limit"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { createInvite } from "@/services/organization-service"

import { createInviteAction } from "./actions"

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

vi.mock("@/lib/page-auth", () => ({
  loadAuthenticatedPageUser: vi.fn(),
}))

vi.mock("@/lib/action-rate-limit", () => ({
  enforceOutboundEmailRateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/organization-service", () => ({
  createInvite: vi.fn().mockResolvedValue({
    invite: { id: "invite-1", token: "invite-token" },
    emailDelivered: true,
    emailFailureReason: null,
  }),
  OrganizationServiceError: class extends Error {},
  updateMemberRole: vi.fn(),
}))

const MEMBER_ID = "20000000-0000-4000-8000-000000000001"
const ORG_ID = "10000000-0000-4000-8000-000000000001"

function createInviteForm(): FormData {
  const formData = new FormData()
  formData.set("organizationId", ORG_ID)
  formData.set("role", "staff")
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
    vi.mocked(enforceOutboundEmailRateLimit).mockResolvedValue(undefined)
    vi.mocked(createInvite).mockResolvedValue({
      invite: { id: "invite-1", token: "invite-token" },
      emailDelivered: true,
      emailFailureReason: null,
    } as never)
  })

  it("enforces the outbound email budget for the authenticated member", async () => {
    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?message=Invite+email+sent."
    )

    expect(loadAuthenticatedPageUser).toHaveBeenCalledExactlyOnceWith("/people")
    expect(enforceOutboundEmailRateLimit).toHaveBeenCalledExactlyOnceWith({
      userId: MEMBER_ID,
      redirectPath: "/people",
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
      /NEXT_REDIRECT:\/people\?message=Invite\+created/
    )
  })

  it("throttles before the invite is created", async () => {
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error("NEXT_REDIRECT:/people?error=Too+many+emails")
      }
    )

    await expect(createInviteAction(createInviteForm())).rejects.toThrow(
      "NEXT_REDIRECT:/people?error=Too+many+emails"
    )
    expect(createInvite).not.toHaveBeenCalled()
  })

  it("does not flatten a throttle redirect into the generic invite error", async () => {
    // Regression guard: the limiter must stay outside the try/catch, otherwise
    // the redirect (which signals by throwing) is swallowed and re-reported as
    // "Unable to create invite."
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error("NEXT_REDIRECT:/people?error=Too+many+emails")
      }
    )

    await expect(createInviteAction(createInviteForm())).rejects.not.toThrow(
      /Unable\+to\+create\+invite/
    )
  })

  it("keeps an invalid role from reaching authentication or the limiter", async () => {
    const formData = createInviteForm()
    formData.set("role", "sysadmin")

    await expect(createInviteAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/people?error=Choose+a+valid+role."
    )
    expect(loadAuthenticatedPageUser).not.toHaveBeenCalled()
    expect(enforceOutboundEmailRateLimit).not.toHaveBeenCalled()
  })
})
