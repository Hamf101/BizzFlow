import { describe, expect, expectTypeOf, it } from "vitest"

import {
  buildFeedbackRedirect,
  getActionErrorFeedbackCode,
  type ActionFeedbackCode,
  type ActionOutcome,
} from "./action-result"

describe("buildFeedbackRedirect", () => {
  it("preserves validated route state and encodes one stable feedback code", () => {
    expect(
      buildFeedbackRedirect(
        "/documents?view=active#recent",
        "document_uploaded",
        {
          folderId: "folder/one",
        }
      )
    ).toBe(
      "/documents?view=active&folderId=folder%2Fone&feedback=document_uploaded#recent"
    )
  })

  it("removes raw flash copy instead of forwarding it to the browser", () => {
    const redirect = buildFeedbackRedirect(
      "/documents?message=old-copy&error=old-error&feedback=old_code",
      "operation_failed",
      {
        error: "Email provider stack trace",
        message: "A raw tenant-facing sentence",
        view: "archived",
      } as never
    )

    expect(redirect).toBe(
      "/documents?view=archived&feedback=operation_failed"
    )
    expect(redirect).not.toContain("provider")
    expect(redirect).not.toContain("tenant-facing")
    expect(redirect).not.toContain("message=")
    expect(redirect).not.toContain("error=")
  })

  it("keeps outcome and feedback codes closed at compile time", () => {
    const outcome = {
      status: "error",
      code: "operation_failed",
      fieldErrors: { title: ["Enter a title."] },
    } satisfies ActionOutcome
    const code: ActionFeedbackCode = outcome.code

    expectTypeOf(code).toMatchTypeOf<ActionFeedbackCode>()
    expect(outcome).toEqual({
      status: "error",
      code: "operation_failed",
      fieldErrors: { title: ["Enter a title."] },
    })

    if (false) {
      // @ts-expect-error Free-form strings are not valid feedback codes.
      buildFeedbackRedirect("/documents", "raw provider exception")

      buildFeedbackRedirect("/documents", "operation_failed", {
        // @ts-expect-error Raw message fields cannot cross the redirect API.
        message: "raw provider exception",
      })
    }
  })
})

describe("getActionErrorFeedbackCode", () => {
  it.each([
    { error: { statusCode: 400 }, expected: "invalid_input" },
    { error: { statusCode: 403 }, expected: "permission_denied" },
    { error: { statusCode: 409 }, expected: "refresh_required" },
    { error: { statusCode: 428 }, expected: "organization_required" },
    { error: { statusCode: 429 }, expected: "retry_later" },
    { error: { statusCode: 500 }, expected: "operation_failed" },
    { error: new Error("EmailJS provider stack"), expected: "operation_failed" },
  ])("maps service status to $expected without using exception copy", ({ error, expected }) => {
    expect(getActionErrorFeedbackCode(error)).toBe(expected)
  })

  it("uses the caller's closed fallback when no service status is available", () => {
    expect(getActionErrorFeedbackCode(null, "invalid_input")).toBe(
      "invalid_input"
    )
  })
})
