"use client"

import { usePathname } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import {
  capturePostHogEvent,
  identifyPostHogUser,
  schedulePostHogInitialization,
} from "@/lib/posthog"

/**
 * Wraps the dashboard with PostHog analytics tracking.
 *
 * No-op when `NEXT_PUBLIC_POSTHOG_KEY` is absent. Product content renders
 * immediately while page-view and identity work waits for browser idle time.
 *
 * @param props - Product content and optional authenticated user identifier.
 * @returns Product content without an analytics loading boundary.
 */
export function PostHogProvider({
  children,
  userId,
}: {
  children: ReactNode
  userId?: string
}): ReactNode {
  const pathname = usePathname()

  useEffect(() => {
    return schedulePostHogInitialization(async () => {
      if (userId) {
        await identifyPostHogUser(userId)
      }

      await capturePostHogEvent("$pageview", { route: pathname })
    })
  }, [pathname, userId])

  return children
}
