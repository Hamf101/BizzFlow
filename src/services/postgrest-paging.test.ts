import { describe, expect, it, vi } from "vitest"

import {
  escapeLikePattern,
  readAllInBatches,
  readCountedPage,
} from "@/services/postgrest-paging"

function fail(error: unknown): Error {
  return new Error(`caller error: ${JSON.stringify(error)}`)
}

function tooMany(): Error {
  return new Error("too many rows")
}

describe("readCountedPage", () => {
  it("returns the page's rows and the counted total", async () => {
    const countAll = vi.fn(async (): Promise<number> => 0)

    await expect(
      readCountedPage(
        { count: 7, data: [{ id: 1 }], error: null },
        countAll,
        fail
      )
    ).resolves.toEqual({ rows: [{ id: 1 }], total: 7 })
    expect(countAll).not.toHaveBeenCalled()
  })

  it("answers a range past the last row with no rows and a separate count", async () => {
    const countAll = vi.fn(async (): Promise<number> => 42)

    await expect(
      readCountedPage(
        { count: null, data: null, error: { code: "PGRST103" } },
        countAll,
        fail
      )
    ).resolves.toEqual({ rows: [], total: 42 })
    expect(countAll).toHaveBeenCalledOnce()
  })

  it("turns any other failure into the caller's error", async () => {
    await expect(
      readCountedPage(
        { count: null, data: null, error: { code: "42501" } },
        async (): Promise<number> => 0,
        fail
      )
    ).rejects.toThrow('caller error: {"code":"42501"}')
  })
})

describe("readAllInBatches", () => {
  it("reads until an empty batch, even after a short one", async () => {
    const batches = [[1, 2, 3], [4, 5], [6], []]
    const readBatch = vi.fn(
      async (): Promise<{ data: number[]; error: null }> => ({
        data: batches.shift() ?? [],
        error: null,
      })
    )

    await expect(
      readAllInBatches(readBatch, { fail, maxRows: 10, tooMany })
    ).resolves.toEqual([1, 2, 3, 4, 5, 6])
    expect(
      readBatch.mock.calls.map((call: unknown[]): unknown => call[0])
    ).toEqual([undefined, 3, 5, 6])
  })

  it("refuses more rows than its limit instead of truncating them", async () => {
    const batches = [[1, 2, 3], [4, 5, 6], []]

    await expect(
      readAllInBatches(
        async (): Promise<{ data: number[]; error: null }> => ({
          data: batches.shift() ?? [],
          error: null,
        }),
        { fail, maxRows: 5, tooMany }
      )
    ).rejects.toThrow("too many rows")
  })

  it("turns a failed batch into the caller's error", async () => {
    await expect(
      readAllInBatches(
        async (): Promise<{ data: null; error: { code: string } }> => ({
          data: null,
          error: { code: "08006" },
        }),
        { fail, maxRows: 5, tooMany }
      )
    ).rejects.toThrow('caller error: {"code":"08006"}')
  })
})

describe("escapeLikePattern", () => {
  it("makes percent signs, underscores, and backslashes literal", () => {
    expect(escapeLikePattern("50%_off\\x")).toBe("50\\%\\_off\\\\x")
  })
})
