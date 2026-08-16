import posthog from "posthog-js"

import { getPosthogEnv } from "@/lib/env"

/**
 * Initialize PostHog if configured. Returns the PostHog instance when a
 * project key is set, or `null` otherwise.
 *
 * Idempotent — repeated calls return the existing instance without
 * re-initializing.
 */
export function initPostHog(): typeof posthog | null {
  if (typeof window === "undefined") return null

  const config = getPosthogEnv()
  if (!config) return null

  // Avoid re-initialization if already loaded
  if (posthog.__loaded) return posthog

  posthog.init(config.key, {
    api_host: config.host,
    person_profiles: "identified_only",
    capture_pageview: false, // Handled manually in PostHogProvider
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug()
    },
  })
  return posthog
}
