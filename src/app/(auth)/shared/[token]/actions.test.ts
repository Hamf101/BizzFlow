import { beforeEach, describe, expect, it, vi } from "vitest"

import { createClient } from "@/lib/supabase/server"
import {
  acceptDocumentGuestInvite,
  createGuestAccount,
  DocumentServiceError,
} from "@/services/document-service"

import { openSharedDocumentWithPasswordAction } from "./actions"

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-real-ip": "203.0.113.7" })),
}))
vi.mock("@/lib/action-rate-limit", () => ({
  enforceActionRateLimit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/services/organization-service", () => ({ updateProfile: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/services/document-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/document-service")>()),
  acceptDocumentGuestInvite: vi.fn(),
  createGuestAccount: vi.fn(),
}))

const USER_ID = "20000000-0000-4000-8000-000000000002"
const PASSWORD = "Correct-horse-battery-5taple"

describe("someone outside the workspace opening a shared document", () => {
  const signInWithPassword = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(createGuestAccount).mockResolvedValue({ email: "sam@example.com", existing: false })
    vi.mocked(acceptDocumentGuestInvite).mockResolvedValue({ documentId: "document 1" })
    signInWithPassword.mockResolvedValue({ data: { user: { email: "sam@example.com", id: USER_ID } }, error: null })
    vi.mocked(createClient).mockResolvedValue({ auth: { signInWithPassword } } as never)
  })

  it("opens an account, signs in as the invited address, accepts, and lands on the document", async () => {
    await expect(openSharedDocumentWithPasswordAction(openForm())).rejects.toThrow(
      "NEXT_REDIRECT:/documents/document%201/preview"
    )
    expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "sam@example.com", password: PASSWORD })
    expect(acceptDocumentGuestInvite).toHaveBeenCalledExactlyOnceWith({
      token: "share-token",
      userEmail: "sam@example.com",
      userId: USER_ID,
    })
  })

  it("sends them back to the link with the reason when it has expired, accepting nothing", async () => {
    vi.mocked(createGuestAccount).mockRejectedValue(new DocumentServiceError("This link has expired. Ask for a new one.", 410))

    await expect(openSharedDocumentWithPasswordAction(openForm())).rejects.toThrow(
      "NEXT_REDIRECT:/shared/share-token?error=This+link+has+expired+or+was+already+used.+Ask+for+a+new+one."
    )
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(acceptDocumentGuestInvite).not.toHaveBeenCalled()
  })
})

function openForm(): FormData {
  const formData = new FormData()
  const values = {
    account: "new",
    confirm: PASSWORD,
    displayName: "Sam Okafor",
    password: PASSWORD,
    phoneNumber: "",
    token: "share-token",
  }

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value)
  }

  return formData
}
