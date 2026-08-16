import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  enforceActionRateLimit,
  enforceOutboundEmailRateLimit,
} from "@/lib/action-rate-limit"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import {
  resendDocumentSigningInvitation,
  sendDocumentForSigning,
} from "@/services/document-signing-service"

import {
  resendGeneratedDocumentInvitationAction,
  sendGeneratedDocumentAction,
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

vi.mock("@/services/document-signing-service", () => ({
  DocumentSigningServiceError: class extends Error {},
  resendDocumentSigningInvitation: vi.fn().mockResolvedValue(undefined),
  saveGeneratedDocumentAnswers: vi.fn(),
  sendDocumentForSigning: vi.fn().mockResolvedValue(undefined),
}))

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
  vi.mocked(enforceActionRateLimit).mockResolvedValue(undefined)
  vi.mocked(enforceOutboundEmailRateLimit).mockResolvedValue(undefined)
})

describe("resendGeneratedDocumentInvitationAction", () => {
  it("budgets each recipient separately from the sending member", async () => {
    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.toThrow("NEXT_REDIRECT:")

    expect(enforceActionRateLimit).toHaveBeenCalledExactlyOnceWith({
      bucket: "email_recipient",
      key: `${MEMBER_ID}:${DOCUMENT_ID}:${RECIPIENT_ID}`,
      redirectPath: EDITOR_PATH,
      message:
        "This invitation was resent too recently. Wait a while before trying again.",
    })
    expect(enforceOutboundEmailRateLimit).toHaveBeenCalledExactlyOnceWith({
      userId: MEMBER_ID,
      redirectPath: EDITOR_PATH,
    })
  })

  it("throttles before the invitation is rotated and re-mailed", async () => {
    vi.mocked(enforceActionRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?error=Resent+too+recently`)
      }
    )

    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.toThrow(`NEXT_REDIRECT:${EDITOR_PATH}?error=Resent+too+recently`)
    expect(resendDocumentSigningInvitation).not.toHaveBeenCalled()
  })

  it("does not flatten a throttle redirect into the generic resend error", async () => {
    // Regression guard: the limiter must stay outside the try/catch, otherwise
    // handleMemberActionFailure swallows the redirect and reports the fallback
    // "Unable to resend the signing invitation." instead.
    vi.mocked(enforceOutboundEmailRateLimit).mockImplementation(
      async (): Promise<void> => {
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?error=Too+many+emails`)
      }
    )

    await expect(
      resendGeneratedDocumentInvitationAction(createResendForm())
    ).rejects.not.toThrow(/Unable\+to\+resend/)
  })
})

describe("sendGeneratedDocumentAction", () => {
  it("budgets the fan-out against the authenticated member", async () => {
    await expect(
      sendGeneratedDocumentAction(createSendForm())
    ).rejects.toThrow("NEXT_REDIRECT:")

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
        throw new Error(`NEXT_REDIRECT:${EDITOR_PATH}?error=Too+many+emails`)
      }
    )

    await expect(sendGeneratedDocumentAction(createSendForm())).rejects.toThrow(
      `NEXT_REDIRECT:${EDITOR_PATH}?error=Too+many+emails`
    )
    expect(sendDocumentForSigning).not.toHaveBeenCalled()
  })
})
