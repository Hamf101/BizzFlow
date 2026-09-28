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

  it("outlasts a lock held for a second, as trashing a thousand-file folder can", async () => {
    vi.useFakeTimers()
    const released = Date.now() + 1_000
    const write = vi.fn(async () => (Date.now() < released ? busy : saved))

    const result = retrySerializationFailure(write)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe(saved)
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
