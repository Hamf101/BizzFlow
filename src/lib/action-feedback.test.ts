import { describe, expect, it } from "vitest"

import { getActionFeedback } from "./action-feedback"

describe("action feedback registry", () => {
  it.each([undefined, null, "", "edited_success", "EmailJS provider stack"])(
    "fails closed without reflecting unknown runtime input: %s",
    (value) => {
      expect(getActionFeedback(value)).toBeNull()
    }
  )
})
