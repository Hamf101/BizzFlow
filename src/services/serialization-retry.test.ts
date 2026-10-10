import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isSerializationFailure,
  retrySerializationFailure,
} from "@/services/serialization-retry"

const busy = {
  data: null,
  error: {
    code: "40001",
    message: "Document folder assignment changed concurrently; retry the operation.",
  },
}
const saved = { data: { id: "folder-1" }, error: null }
const refused = { data: null, error: { code: "23505", message: "Duplicate." } }

async function noPause(): Promise<void> {}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("retrySerializationFailure", () => {
  it("writes again while the database asks for a retry, then keeps the first other answer", async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(busy)
      .mockResolvedValueOnce(saved)

    await expect(retrySerializationFailure(write, noPause)).resolves.toBe(saved)
    expect(write).toHaveBeenCalledTimes(3)
  })

  it("outlasts a lock held for a second, as trashing a thousand-file folder can, at the average pause", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const released = Date.now() + 1_000
    const write = vi.fn(async () => (Date.now() < released ? busy : saved))

    const result = retrySerializationFailure(write)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe(saved)
  })

  it("waits a random share of each doubling window, so writers that collided do not collide again", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.1)
    const startedAt = Date.now()
    const at: number[] = []
    const write = vi.fn(async () => {
      at.push(Date.now() - startedAt)
      return at.length < 4 ? busy : saved
    })

    const result = retrySerializationFailure(write)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe(saved)
    // A tenth of 50, 100 and 200 ms.
    expect(at).toEqual([0, 5, 15, 35])
  })

  it("stops after seven attempts with the last answer, and never repeats other errors", async () => {
    const stuck = vi.fn().mockResolvedValue(busy)

    await expect(retrySerializationFailure(stuck, noPause)).resolves.toBe(busy)
    expect(stuck).toHaveBeenCalledTimes(7)

    const duplicate = vi.fn().mockResolvedValue(refused)

    await expect(retrySerializationFailure(duplicate, noPause)).resolves.toBe(refused)
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(isSerializationFailure(refused.error)).toBe(false)
  })
})
