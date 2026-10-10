import { afterEach, describe, expect, it, vi } from "vitest"

import { RateLimitError } from "@/lib/rate-limit"
import { createRateLimitResponse } from "@/lib/rate-limit-response"

describe("createRateLimitResponse", () => {
  afterEach((): void => {
    vi.restoreAllMocks()
  })

  it("returns a 429 carrying the retry hint", async (): Promise<void> => {
    vi.spyOn(console, "warn").mockImplementation((): void => {})

    const response = createRateLimitResponse(
      new RateLimitError(42),
      "document_route_rejected",
      "documents_pdf"
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("42")
    await expect(response.json()).resolves.toEqual({
      error: "Too many requests. Try again shortly.",
    })
  })
})
