import { afterEach, describe, expect, it, vi } from "vitest"

import {
  captureUnexpectedError,
  redactSigningTokens,
  scrubMonitoringEvent,
  setErrorReporter,
} from "./observability"

afterEach(() => {
  setErrorReporter(null)
})

describe("captureUnexpectedError", () => {
  it("is a no-op when no reporter is registered", () => {
    expect(() =>
      captureUnexpectedError(new Error("boom"), { operationName: "op" })
    ).not.toThrow()
  })

  it("forwards the original error and context to the reporter", () => {
    const reporter = vi.fn()
    const error = new Error("database exploded")
    setErrorReporter(reporter)

    captureUnexpectedError(error, { operationName: "create_document" })

    expect(reporter).toHaveBeenCalledExactlyOnceWith(error, {
      operationName: "create_document",
    })
  })

  it("never throws when the reporter itself fails", () => {
    setErrorReporter(() => {
      throw new Error("transport down")
    })

    expect(() =>
      captureUnexpectedError(new Error("boom"), { operationName: "op" })
    ).not.toThrow()
  })

  it("stops reporting after the reporter is cleared", () => {
    const reporter = vi.fn()
    setErrorReporter(reporter)
    setErrorReporter(null)

    captureUnexpectedError(new Error("boom"), { operationName: "op" })

    expect(reporter).not.toHaveBeenCalled()
  })
})

describe("redactSigningTokens", () => {
  it("redacts every signing token path segment", () => {
    expect(
      redactSigningTokens(
        "https://app.example.com/sign/abc123XY?step=2 and /sign/other-token"
      )
    ).toBe("https://app.example.com/sign/[redacted]?step=2 and /sign/[redacted]")
  })

  it("leaves unrelated paths untouched", () => {
    expect(redactSigningTokens("/documents/abc/sign-off")).toBe(
      "/documents/abc/sign-off"
    )
  })
})

describe("scrubMonitoringEvent", () => {
  it("drops request bodies and redacts request and breadcrumb URLs", () => {
    const event = scrubMonitoringEvent({
      request: {
        url: "https://app.example.com/sign/secret-token",
        query_string: "next=%2Fsign%2Fsecret-token",
        data: { answer: "sensitive" },
      },
      breadcrumbs: [
        {
          message: "navigated to /sign/secret-token",
          data: {
            url: "https://app.example.com/sign/secret-token",
            to: "/sign/secret-token",
          },
        },
      ],
    })

    expect(event.request).toEqual({
      url: "https://app.example.com/sign/[redacted]",
    })
    expect(event.breadcrumbs).toEqual([
      {
        message: "navigated to /sign/[redacted]",
        data: {
          url: "https://app.example.com/sign/[redacted]",
          to: "/sign/[redacted]",
        },
      },
    ])
  })

  it("returns events without request or breadcrumbs unchanged", () => {
    expect(scrubMonitoringEvent({})).toEqual({})
  })
})
