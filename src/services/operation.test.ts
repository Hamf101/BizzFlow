import { afterEach, describe, expect, it, vi } from "vitest"

import { setErrorReporter } from "@/lib/observability"
import { runOperation } from "@/services/operation"

class ShelfError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
  }
}

// As a domain translates: its own errors pass, anything else is a failure.
function toShelfError(error: unknown): ShelfError {
  return error instanceof ShelfError ? error : new ShelfError("Shelf service failed.", 500)
}

function run<T>(operation: () => Promise<T>): Promise<T> {
  return runOperation("shelf", toShelfError, "count_books", { shelfId: "shelf-1" }, operation)
}

afterEach(() => {
  setErrorReporter(null)
  vi.restoreAllMocks()
})

describe("runOperation", () => {
  it("logs a refusal as rejected with the reason shown, and reports nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = vi.fn()
    setErrorReporter(reporter)

    await expect(run(() => Promise.reject(new ShelfError("That shelf is full.", 409)))).rejects.toMatchObject({
      message: "That shelf is full.",
      statusCode: 409,
    })
    expect(warn).toHaveBeenCalledWith(
      "shelf_service_rejected",
      expect.objectContaining({ operationName: "count_books", reason: "That shelf is full.", shelfId: "shelf-1", statusCode: 409 })
    )
    expect(reporter).not.toHaveBeenCalled()
  })

  it("logs and reports a failure with its real reason, and shows only the safe message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const reporter = vi.fn()
    setErrorReporter(reporter)
    const cause = new Error("connect ECONNRESET 10.0.0.3:5432")

    await expect(run(() => Promise.reject(cause))).rejects.toMatchObject({
      message: "Shelf service failed.",
      statusCode: 500,
    })
    expect(error).toHaveBeenCalledWith(
      "shelf_service_failed",
      expect.objectContaining({ reason: "connect ECONNRESET 10.0.0.3:5432", shelfId: "shelf-1", statusCode: 500 })
    )
    expect(reporter).toHaveBeenCalledWith(cause, expect.objectContaining({ operationName: "count_books" }))
  })

  it("reports a known error that means the server failed, such as a database one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const reporter = vi.fn()
    setErrorReporter(reporter)

    await expect(run(() => Promise.reject(new ShelfError("Unable to load books.", 500)))).rejects.toMatchObject({
      statusCode: 500,
    })
    expect(reporter).toHaveBeenCalledOnce()
  })

  it("logs every slow success and one in ten of the rest", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const random = vi.spyOn(Math, "random")
    const now = vi.spyOn(Date, "now")

    now.mockReturnValueOnce(0).mockReturnValueOnce(40)
    random.mockReturnValueOnce(0.5)
    await expect(run(async () => 3)).resolves.toBe(3)
    expect(info).not.toHaveBeenCalled()

    now.mockReturnValueOnce(0).mockReturnValueOnce(40)
    random.mockReturnValueOnce(0.05)
    await run(async () => 3)
    expect(info).toHaveBeenLastCalledWith("shelf_service_success", expect.objectContaining({ durationMs: 40, shelfId: "shelf-1" }))

    now.mockReturnValueOnce(0).mockReturnValueOnce(1_500)
    random.mockReturnValueOnce(0.99)
    await run(async () => 3)
    expect(info).toHaveBeenCalledTimes(2)
    expect(info).toHaveBeenLastCalledWith("shelf_service_success", expect.objectContaining({ durationMs: 1_500 }))
  })
})
