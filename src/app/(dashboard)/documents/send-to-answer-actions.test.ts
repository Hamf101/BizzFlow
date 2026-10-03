import { describe, expect, it, vi } from "vitest"

import { checkRateLimit, hashRateLimitKeyPart } from "@/lib/rate-limit"

import { resendAnswerRequestAction } from "./send-to-answer-actions"

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/auth", () => ({ AuthenticationError: class extends Error {}, getAuthenticatedUser: vi.fn(async () => ({ id: "user-1" })) }))
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
}))
vi.mock("@/services/organization-service", () => ({
  getCurrentOrganizationContext: vi.fn(async () => ({ organization: { id: "org-1" } })),
}))
vi.mock("@/services/send-to-answer-service", () => ({
  MAX_ANSWER_RECIPIENTS: 10,
  listAnswerRequests: vi.fn(async () => []),
  readAnswerRequestRecipient: vi.fn(async () => "ana@example.com"),
  resendAnswerRequest: vi.fn(async () => ({ delivered: true, email: "ana@example.com", linkId: "l", token: null })),
}))

describe("resending a request to answer", () => {
  it("spends the recipient's own email budget, not one per link", async () => {
    const result = await resendAnswerRequestAction({
      linkId: "70000000-0000-4000-8000-000000000001",
      source: { documentId: "30000000-0000-4000-8000-000000000001", kind: "document" },
    })

    expect(result).toMatchObject({ ok: true })
    expect(checkRateLimit).toHaveBeenCalledWith("email_recipient", hashRateLimitKeyPart("ana@example.com"))
  })
})
