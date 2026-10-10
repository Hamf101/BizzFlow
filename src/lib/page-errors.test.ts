import { describe, expect, it } from "vitest"

import { getPageErrorMessage } from "@/lib/page-errors"
import { DocumentServiceError } from "@/services/documents/errors"

const FALLBACK = "Unable to load document."

describe("page error messages", () => {
  it("shows only a service's own client-facing refusal, never raw SDK or server-failure text", () => {
    expect(
      getPageErrorMessage(new DocumentServiceError("Document was not found.", 404), FALLBACK)
    ).toBe("Document was not found.")
    expect(
      getPageErrorMessage(
        new Error("NoSuchKey: organizations/org-1/documents/private.pdf (bucket bizflow-prod)"),
        FALLBACK
      )
    ).toBe(FALLBACK)
    expect(
      getPageErrorMessage(new DocumentServiceError("Supabase admin client failed.", 500), FALLBACK)
    ).toBe(FALLBACK)
    expect(getPageErrorMessage("unexpected rejection", FALLBACK)).toBe(FALLBACK)
  })
})
