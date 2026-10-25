import { describe, expect, it, vi } from "vitest"

import { handleFinalizeCompletedDocuments } from "@/inngest/functions/finalize-completed-documents"
import { createRecordingStep } from "@/inngest/functions/test-support"

describe("handleFinalizeCompletedDocuments", () => {
  it("still makes the uploads' signed copies when the generated documents fail, then reports the failure", async () => {
    const finalizeUploads = vi.fn(async () => ({ finalizedCount: 2 }))
    const run = handleFinalizeCompletedDocuments(
      { step: createRecordingStep() },
      { finalizeGenerated: async () => Promise.reject(new Error("render down")), finalizeUploads }
    )

    await expect(run).rejects.toThrow("render down")
    expect(finalizeUploads).toHaveBeenCalledOnce()
  })

  it("reports both failures when both sweeps fail", async () => {
    const run = handleFinalizeCompletedDocuments(
      { step: createRecordingStep() },
      { finalizeGenerated: async () => Promise.reject(new Error("render down")), finalizeUploads: async () => Promise.reject(new Error("storage down")) }
    )

    await expect(run).rejects.toMatchObject({ errors: [new Error("render down"), new Error("storage down")] })
  })
})
