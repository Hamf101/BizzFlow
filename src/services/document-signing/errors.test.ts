import { describe, expect, it } from "vitest"

import {
  createDatabaseError,
  DocumentSigningServiceError,
} from "@/services/document-signing/errors"

describe("document signing database errors", () => {
  it("maps the active-document lifecycle trigger to a conflict", () => {
    const error = createDatabaseError(
      {
        code: "P0001",
        message: "Only active documents may be modified.",
      },
      "Unable to save document answers."
    )

    expect(error).toBeInstanceOf(DocumentSigningServiceError)
    expect(error).toMatchObject({
      message: "Archived documents cannot be changed.",
      statusCode: 409,
    })
  })

  it("keeps unrelated P0001 failures on the safe fallback", () => {
    const error = createDatabaseError(
      {
        code: "P0001",
        message: "Unexpected signing workflow failure.",
      },
      "Unable to save document answers."
    )

    expect(error).toMatchObject({
      message: "Unable to save document answers.",
      statusCode: 500,
    })
  })
})
