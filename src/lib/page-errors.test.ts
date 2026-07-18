import { describe, expect, it } from "vitest"

import { getPageErrorMessage } from "@/lib/page-errors"

describe("page error messages", () => {
  it("preserves an Error message supplied by a domain service", () => {
    expect(
      getPageErrorMessage(
        new Error("The requested document is unavailable."),
        "Unable to load document."
      )
    ).toBe("The requested document is unavailable.")
  })

  it("uses the page fallback for non-Error rejections", () => {
    expect(
      getPageErrorMessage("unexpected rejection", "Unable to load document.")
    ).toBe("Unable to load document.")
  })
})
