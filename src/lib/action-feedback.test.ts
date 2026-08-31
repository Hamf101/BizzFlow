import { describe, expect, it } from "vitest"

import { ACTION_FEEDBACK_CODES } from "./action-result"
import { ACTION_FEEDBACK, getActionFeedback } from "./action-feedback"

describe("action feedback registry", () => {
  it("defines one fixed entry for every feedback code", () => {
    expect(Object.keys(ACTION_FEEDBACK).sort()).toEqual(
      [...ACTION_FEEDBACK_CODES].sort()
    )

    for (const code of ACTION_FEEDBACK_CODES) {
      const feedback = getActionFeedback(code)

      expect(feedback).toMatchObject({
        code,
        title: expect.any(String),
        tone: expect.stringMatching(/^(success|error|info)$/),
        analyticsEvent: expect.any(String),
        persistent: expect.any(Boolean),
      })
      expect(feedback?.title.trim().length).toBeGreaterThan(0)
      expect(feedback?.durationMs).toBeGreaterThan(0)
    }
  })

  it.each([undefined, null, "", "edited_success", "EmailJS provider stack"])(
    "fails closed without reflecting unknown runtime input: %s",
    (value) => {
      expect(getActionFeedback(value)).toBeNull()
    }
  )
})
