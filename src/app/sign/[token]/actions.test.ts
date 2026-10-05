import { beforeEach, describe, expect, it, vi } from "vitest"

import { completePublicDocumentSigning, DocumentSigningServiceError } from "@/services/document-signing-service"
import { finalizeCompletedGeneratedDocument } from "@/services/generated-document-finalization-service"

import { completePublicSigningAction } from "./actions"

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
}))
// Work deferred past the response runs at once, so the test sees it.
vi.mock("next/server", () => ({ after: (task: () => unknown) => void task() }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(), RateLimitError: class RateLimitError extends Error {} }))
vi.mock("@/services/document-signing-service", () => ({
  DocumentSigningServiceError: class DocumentSigningServiceError extends Error {},
  completePublicDocumentSigning: vi.fn(),
}))
vi.mock("@/services/generated-document-finalization-service", () => ({
  finalizeCompletedGeneratedDocument: vi.fn(async () => undefined),
}))

const DOCUMENT = { id: "document-1", organizationId: "org-1", createdBy: "user-1" }

describe("public signing action", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    ["completed", 1],
    ["awaiting_signatures", 0],
  ] as const)("finalizes the paper only when the last signature completes it (%s)", async (workflowStatus, calls) => {
    vi.mocked(completePublicDocumentSigning).mockResolvedValue({
      document: DOCUMENT,
      recipient: { id: "recipient-1" },
      workflowStatus,
    } as never)
    const formData = new FormData()
    formData.set("token", "token-1")

    await expect(completePublicSigningAction(null, formData)).rejects.toThrow("NEXT_REDIRECT:/sign/token-1")
    expect(finalizeCompletedGeneratedDocument).toHaveBeenCalledTimes(calls)
    if (calls) expect(finalizeCompletedGeneratedDocument).toHaveBeenCalledWith(DOCUMENT)
  })

  it("answers a refusal on the same page, so the signer's drawing and answers stay", async () => {
    vi.mocked(completePublicDocumentSigning).mockRejectedValue(new DocumentSigningServiceError("This link has expired.", 410))
    const formData = new FormData()
    formData.set("token", "token-1")

    await expect(completePublicSigningAction(null, formData)).resolves.toEqual({ error: "This link has expired." })
    expect(finalizeCompletedGeneratedDocument).not.toHaveBeenCalled()
  })
})
