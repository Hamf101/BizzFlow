// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { handOffToFlow, takeFlowHandoff } from "./flow-handoff"

afterEach(() => {
  vi.useRealTimers()
  sessionStorage.clear()
})

describe("the Flow handoff", () => {
  it("carries a request to the next editor once, and only while it is fresh", () => {
    vi.useFakeTimers()
    handOffToFlow("Draft an intake form")

    expect(takeFlowHandoff()).toEqual({ instruction: "Draft an intake form" })
    expect(takeFlowHandoff()).toBeNull()

    // A form attached to the request goes with it, so the editor's Flow reads it too.
    handOffToFlow("Recreate this form", { id: "60000000-0000-4000-8000-000000000001", name: "Intake.pdf" })

    expect(takeFlowHandoff()).toEqual({
      instruction: "Recreate this form",
      source: { id: "60000000-0000-4000-8000-000000000001", name: "Intake.pdf" },
    })

    handOffToFlow("Draft an agreement")
    vi.advanceTimersByTime(61_000)

    expect(takeFlowHandoff()).toBeNull()
  })
})
