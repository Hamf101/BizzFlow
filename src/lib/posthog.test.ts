import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const posthog = {
    __loaded: false,
    capture: vi.fn(),
    identify: vi.fn(),
    init: vi.fn(),
  }

  return {
    getPosthogEnv: vi.fn(),
    posthog,
  }
})

vi.mock("@/lib/env", () => ({
  getPosthogEnv: mocks.getPosthogEnv,
}))

vi.mock("posthog-js", () => ({
  default: mocks.posthog,
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.posthog.__loaded = false
  mocks.posthog.init.mockImplementation(() => {
    mocks.posthog.__loaded = true
  })
  vi.stubGlobal("window", {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PostHog lazy lifecycle", () => {
  it("loads and initializes the browser client once when configured", async () => {
    mocks.getPosthogEnv.mockReturnValue({
      key: "phc_test",
      host: "https://analytics.example.com",
    })
    const { loadPostHog } = await import("./posthog")

    const [first, second] = await Promise.all([loadPostHog(), loadPostHog()])

    expect(first).toBe(mocks.posthog)
    expect(second).toBe(mocks.posthog)
    expect(mocks.posthog.init).toHaveBeenCalledTimes(1)
    expect(mocks.posthog.init).toHaveBeenCalledWith("phc_test", {
      api_host: "https://analytics.example.com",
      capture_pageview: false,
      person_profiles: "identified_only",
    })
  })

  it("fails open when analytics is disabled or initialization throws", async () => {
    mocks.getPosthogEnv.mockReturnValue(null)
    const disabled = await import("./posthog")

    await expect(disabled.loadPostHog()).resolves.toBeNull()
    expect(mocks.posthog.init).not.toHaveBeenCalled()

    vi.resetModules()
    mocks.getPosthogEnv.mockReturnValue({
      key: "phc_test",
      host: "https://analytics.example.com",
    })
    mocks.posthog.init.mockImplementationOnce(() => {
      throw new Error("network blocked")
    })
    const failed = await import("./posthog")

    await expect(failed.loadPostHog()).resolves.toBeNull()
  })

  it("captures only stable events and keeps tenant data out of routes", async () => {
    mocks.getPosthogEnv.mockReturnValue({
      key: "phc_test",
      host: "https://analytics.example.com",
    })
    const { capturePostHogEvent } = await import("./posthog")

    await capturePostHogEvent("action_outcome", {
      outcomeCode: "template_published",
      route: "/templates?token=secret#private",
    })

    expect(mocks.posthog.capture).toHaveBeenCalledWith("action_outcome", {
      outcomeCode: "template_published",
      route: "/templates",
    })

    // Which document, submission, or task someone opened is theirs, not the
    // analytics provider's.
    await capturePostHogEvent("$pageview", {
      route: "/documents/0f8d4a2c-1c44-4f2e-9a1b-7b2e6d5c3a10/edit",
    })

    expect(mocks.posthog.capture).toHaveBeenLastCalledWith("$pageview", {
      route: "/documents/:id/edit",
    })
  })

  it("schedules initialization with a bounded idle timeout and cancels cleanup", async () => {
    const idleCallback = vi.fn<() => void>()
    const scheduler = {
      cancelIdleCallback: vi.fn(),
      clearTimeout: vi.fn(),
      requestIdleCallback: vi.fn((callback: () => void) => {
        idleCallback.mockImplementation(callback)
        return 42
      }),
      setTimeout: vi.fn(() => 7),
    }
    const task = vi.fn()
    const { schedulePostHogInitialization } = await import("./posthog")

    const cleanup = schedulePostHogInitialization(task, scheduler)

    expect(scheduler.requestIdleCallback).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 2_000 }
    )
    idleCallback()
    expect(task).toHaveBeenCalledTimes(1)

    cleanup()
    expect(scheduler.cancelIdleCallback).toHaveBeenCalledWith(42)
    expect(scheduler.setTimeout).not.toHaveBeenCalled()
  })

  it("uses and clears a timer when idle callbacks are unavailable", async () => {
    const timerCallback = vi.fn<() => void>()
    const scheduler = {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => {
        timerCallback.mockImplementation(callback)
        return 9
      }),
    }
    const task = vi.fn()
    const { schedulePostHogInitialization } = await import("./posthog")

    const cleanup = schedulePostHogInitialization(task, scheduler)
    timerCallback()

    expect(task).toHaveBeenCalledTimes(1)
    cleanup()
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(9)
  })
})
