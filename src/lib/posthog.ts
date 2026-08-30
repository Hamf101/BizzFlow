import type { ActionFeedbackCode } from "@/lib/action-result"
import { getPosthogEnv } from "@/lib/env"

type PostHogClient = (typeof import("posthog-js"))["default"]

/** Stable analytics events emitted by the current product surfaces. */
export type AnalyticsEventName =
  | "$pageview"
  | "action_outcome"
  | "document_uploaded"
  | "submission_created"
  | "submission_submitted"
  | "task_completed"
  | "task_created"
  | "template_created"
  | "template_duplicated"
  | "template_published"

/** Allowlisted metadata that may cross the browser-to-analytics boundary. */
export type AnalyticsEventProperties = Readonly<{
  outcomeCode?: ActionFeedbackCode
  route?: string
}>

/** Browser scheduling surface used to defer optional analytics work. */
export type PostHogScheduler = Readonly<{
  cancelIdleCallback?: (handle: number) => void
  clearTimeout: (handle: number) => void
  requestIdleCallback?: (
    callback: () => void,
    options: { timeout: number }
  ) => number
  setTimeout: (callback: () => void, delay: number) => number
}>

let posthogPromise: Promise<PostHogClient | null> | null = null

async function initializePostHog(): Promise<PostHogClient | null> {
  try {
    const config = getPosthogEnv()
    if (!config) return null

    const { default: posthog } = await import("posthog-js")

    if (!posthog.__loaded) {
      posthog.init(config.key, {
        api_host: config.host,
        capture_pageview: false,
        person_profiles: "identified_only",
      })
    }

    return posthog
  } catch {
    return null
  }
}

/**
 * Lazily loads and initializes the optional PostHog browser client once.
 *
 * @returns The initialized client, or null on the server, when disabled, or on failure.
 */
export function loadPostHog(): Promise<PostHogClient | null> {
  if (typeof window === "undefined") return Promise.resolve(null)

  posthogPromise ??= initializePostHog()
  return posthogPromise
}

function normalizeAnalyticsProperties(
  properties: AnalyticsEventProperties | undefined
): AnalyticsEventProperties | undefined {
  if (!properties) return undefined

  const normalized: AnalyticsEventProperties = {
    ...(properties.outcomeCode
      ? { outcomeCode: properties.outcomeCode }
      : {}),
    ...(properties.route
      ? { route: properties.route.split(/[?#]/, 1)[0] || "/" }
      : {}),
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * Captures one stable event with only allowlisted, redacted properties.
 *
 * @param name - Closed event name used by product analytics.
 * @param properties - Stable outcome code or route pathname without query data.
 */
export async function capturePostHogEvent(
  name: AnalyticsEventName,
  properties?: AnalyticsEventProperties
): Promise<void> {
  try {
    const posthog = await loadPostHog()
    posthog?.capture(name, normalizeAnalyticsProperties(properties))
  } catch {
    // Optional analytics must never interrupt the product interaction.
  }
}

/**
 * Identifies an authenticated analytics session without blocking the shell.
 *
 * @param userId - Internal authenticated user identifier.
 */
export async function identifyPostHogUser(userId: string): Promise<void> {
  try {
    const posthog = await loadPostHog()
    posthog?.identify(userId)
  } catch {
    // Optional analytics must never interrupt the product interaction.
  }
}

/**
 * Defers analytics work until the browser is idle, with a bounded timer fallback.
 *
 * @param task - Non-blocking analytics work to start.
 * @param scheduler - Browser scheduling surface, injectable for deterministic tests.
 * @returns Cleanup that cancels pending work.
 */
export function schedulePostHogInitialization(
  task: () => void | Promise<void>,
  scheduler: PostHogScheduler = window
): () => void {
  let active = true
  const run = (): void => {
    if (!active) return
    void Promise.resolve(task()).catch(() => undefined)
  }

  if (scheduler.requestIdleCallback && scheduler.cancelIdleCallback) {
    const handle = scheduler.requestIdleCallback(run, { timeout: 2_000 })

    return (): void => {
      active = false
      scheduler.cancelIdleCallback?.(handle)
    }
  }

  const handle = scheduler.setTimeout(run, 0)
  return (): void => {
    active = false
    scheduler.clearTimeout(handle)
  }
}
