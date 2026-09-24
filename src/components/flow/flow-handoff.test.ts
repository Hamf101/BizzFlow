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

    expect(takeFlowHandoff()).toBe("Draft an intake form")
    expect(takeFlowHandoff()).toBeNull()

    handOffToFlow("Draft an agreement")
    vi.advanceTimersByTime(61_000)

    expect(takeFlowHandoff()).toBeNull()
  })
})
