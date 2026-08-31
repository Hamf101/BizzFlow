import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  enforceActionRateLimit,
  enforceOutboundEmailRateLimit,
} from "@/lib/action-rate-limit"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  DocumentSigningServiceError,
  resendDocumentSigningInvitation,
  saveGeneratedDocumentAnswers,
  sendDocumentForSigning,
} from "@/services/document-signing-service"

import {
  resendGeneratedDocumentInvitationAction,
  saveGeneratedDocumentAction,
  sendGeneratedDocumentAction,
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

vi.mock("@/lib/page-auth", () => ({
  loadAuthenticatedPageUser: vi.fn(),
}))

vi.mock("@/lib/action-rate-limit", () => ({
  enforceActionRateLimit: vi.fn().mockResolvedValue(undefined),
  enforceOutboundEmailRateLimit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(async () => ({
    organization: { id: ORG_ID },
    membership: { role: "owner_admin" },
  })),
}))

vi.mock("@/services/document-signing-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/services/document-signing-service")
  >()
  return {
    ...actual,
    resendDocumentSigningInvitation: vi.fn().mockResolvedValue(undefined),
    saveGeneratedDocumentAnswers: vi.fn().mockResolvedValue(undefined),
    sendDocumentForSigning: vi.fn().mockResolvedValue(undefined),
  }
})

const MEMBER_ID = "20000000-0000-4000-8000-000000000001"
const ORG_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "30000000-0000-4000-8000-000000000001"
const RECIPIENT_ID = "40000000-0000-4000-8000-000000000001"
const EDITOR_PATH = `/documents/${DOCUMENT_ID}/edit`

function createResendForm(): FormData {
  const formData = new FormData()
  formData.set("documentId", DOCUMENT_ID)
  formData.set("recipientId", RECIPIENT_ID)
  return formData
}

function createSendForm(): FormData {
  const formData = new FormData()
  formData.set("documentId", DOCUMENT_ID)
  formData.set(
    "recipients",
    JSON.stringify([
      { name: "Signer", email: "signer@example.com", requiresSignature: true },
    ])
  )
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadAuthenticatedPageUser).mockResolvedValue({
    id: MEMBER_ID,
    email: "member@example.com",
  } as never)
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    id: MEMBER_ID,
    email: "member@example.com",
  })
  vi.mocked(enforceActionRateLimit).mockResolvedValue(undefined)
  vi.mocked(enforceOutboundEmailRateLimit).mockResolvedValue(undefined)
  vi.mocked(resendDocumentSigningInvitation).mockResolvedValue(undefined as never)
  vi.mocked(saveGeneratedDocumentAnswers).mockResolvedValue(undefined as never)
  vi.mocked(sendDocumentForSigning).mockResolvedValue(undefined as never)
})

describe("resendGeneratedDocumentInvitationAction", () => {
  it("budgets each recipient separately from the sending member", async () => {
    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?feedback=signing_invitation_resent`
    )

    expect(enforceActionRateLimit).toHaveBeenCalledExactlyOnceWith({
      bucket: "email_recipient",
      feedbackCode: "retry_later",
      key: `${MEMBER_ID}:${DOCUMENT_ID}:${RECIPIENT_ID}`,
      redirectPath: EDITOR_PATH,
    })
    expect(enforceOutboundEmailRateLimit).toHaveBeenCalledExactlyOnceWith({
      userId: MEMBER_ID,
      redirectPath: EDITOR_PATH,
    })
  })

  it("throttles before the invitation is rotated and re-mailed", async () => {
    vi.mocked(enforceActionRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?feedback=retry_later`)
      }
    )

    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.toThrow(`NEXT_REDIRECT:${EDITOR_PATH}?feedback=retry_later`)
    expect(resendDocumentSigningInvitation).not.toHaveBeenCalled()
  })

  it("does not flatten a throttle redirect into the generic resend error", async () => {
    // Regression guard: the limiter must stay outside the try/catch, otherwise
    // handleMemberActionFailure swallows the redirect and reports the fallback
    // "Unable to resend the signing invitation." instead.
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?feedback=retry_later`)
      }
    )

    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.not.toThrow(/feedback=operation_failed/)
  })
})

describe("sendGeneratedDocumentAction", () => {
  it("budgets the fan-out against the authenticated member", async () => {
    await expect(
      sendGeneratedDocumentAction(createSendForm())
    ).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?feedback=signing_invitations_sent`
    )

    expect(loadAuthenticatedPageUser).toHaveBeenCalledExactlyOnceWith(
      EDITOR_PATH
    )
    expect(enforceOutboundEmailRateLimit).toHaveBeenCalledExactlyOnceWith({
      userId: MEMBER_ID,
      redirectPath: EDITOR_PATH,
    })
  })

  it("throttles before any recipient is mailed", async () => {
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?feedback=retry_later`)
      }
    )

    await expect(sendGeneratedDocumentAction(createSendForm())).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?feedback=retry_later`
    )
    expect(sendDocumentForSigning).not.toHaveBeenCalled()
  })

  it("maps EmailJS-adjacent service diagnostics to fixed feedback", async () => {
    vi.mocked(sendDocumentForSigning).mockRejectedValue(
      new DocumentSigningServiceError("EmailJS provider request detail", 500)
    )

    await expect(sendGeneratedDocumentAction(createSendForm())).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?feedback=operation_failed`
    )
    expect(redirectMock).not.toHaveBeenCalledWith(
      expect.stringContaining("EmailJS")
    )
  })
})

describe("saveGeneratedDocumentAction", () => {
  it("saves answer values before reporting completion", async () => {
    const formData = new FormData()
    formData.set("documentId", DOCUMENT_ID)
    formData.set("answer.text.client-name", "Acme")

    await expect(saveGeneratedDocumentAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?feedback=changes_saved`
    )
    expect(saveGeneratedDocumentAnswers).toHaveBeenCalledExactlyOnceWith({
      actorUserId: MEMBER_ID,
      organizationId: ORG_ID,
      documentId: DOCUMENT_ID,
      values: { "client-name": "Acme" },
    })
  })

  it("preserves the editor login return path", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(
      new AuthenticationError("Sign in to continue.")
    )
    const formData = new FormData()
    formData.set("documentId", DOCUMENT_ID)

    await expect(saveGeneratedDocumentAction(formData)).rejects.toThrow(
      `NEXT_REDIRECT:/login?next=%2Fdocuments%2F${DOCUMENT_ID}%2Fedit`
    )
    expect(saveGeneratedDocumentAnswers).not.toHaveBeenCalled()
  })
})
