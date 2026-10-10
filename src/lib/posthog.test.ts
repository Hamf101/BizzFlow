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
})
