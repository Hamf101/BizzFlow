import { describe, expect, it, vi } from "vitest"

import { createEmailJsRateLimiter } from "@/services/email/emailjs-rate-limiter"

describe("EmailJS rate limiter", () => {
  it("paces concurrent reservations in FIFO order", async () => {
    let currentTimeMs = 0
    const wait = vi.fn(async (durationMs: number): Promise<void> => {
      currentTimeMs += durationMs
    })
    const reserveSendSlot = createEmailJsRateLimiter(1000, {
      now: (): number => currentTimeMs,
      wait,
    })

    await Promise.all([
      reserveSendSlot(),
      reserveSendSlot(),
      reserveSendSlot(),
    ])

    expect(wait).toHaveBeenNthCalledWith(1, 1000)
    expect(wait).toHaveBeenNthCalledWith(2, 1000)
  })

  it("does not delay the first reservation", async () => {
    const wait = vi.fn(async (): Promise<void> => {})
    const reserveSendSlot = createEmailJsRateLimiter(1000, {
      now: (): number => 5000,
      wait,
    })

    await reserveSendSlot()

    expect(wait).not.toHaveBeenCalled()
  })
})
