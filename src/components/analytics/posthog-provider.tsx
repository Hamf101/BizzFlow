"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useRef, Suspense, type ReactNode } from "react"
import { initPostHog } from "@/lib/posthog"
import { trackEvent } from "@/lib/analytics"

/**
 * Wraps the dashboard with PostHog analytics tracking.
 *
 * No-op when `NEXT_PUBLIC_POSTHOG_KEY` is absent. Tracks page views
 * on route changes and identifies the authenticated user. Infers
 * server action outcomes from URL flash messages.
 */
export function PostHogProvider({
  children,
  userId,
}: {
  children: ReactNode
  userId?: string
}) {
  const pathname = usePathname()
  const phRef = useRef<ReturnType<typeof initPostHog>>(undefined)
  const initializedRef = useRef(false)

  // Initialize PostHog once and identify user when available
  useEffect(() => {
    if (!initializedRef.current) {
      phRef.current = initPostHog()
      initializedRef.current = true
    }

    // Identify when userId becomes available (may arrive after initial render)
    if (phRef.current && userId) {
      phRef.current.identify(userId)
    }
  }, [userId])

  // Track page views on route changes — only when PostHog is active
  useEffect(() => {
    if (!phRef.current) return

    phRef.current.capture("$pageview", { $current_url: pathname })
  }, [pathname])

  return (
    <>
      <Suspense fallback={null}>
        <ActionMessageTracker />
      </Suspense>
      {children}
    </>
  )
}

/**
 * Maps URL flash messages from server actions to PostHog events.
 * Wrapped in Suspense because `useSearchParams()` triggers a client boundary.
 */
function ActionMessageTracker() {
  const searchParams = useSearchParams()
  const message = searchParams.get("message")

  useEffect(() => {
    if (!message) return

    switch (message) {
      case "Template draft created.":
      case "Template created.":
        trackEvent("template_created")
        break
      case "Template published.":
        trackEvent("template_published")
        break
      case "Template duplicated.":
        trackEvent("template_duplicated")
        break
      case "Submission draft created.":
      case "Submission created.":
        trackEvent("submission_created")
        break
      case "Submission sent for review.":
      case "Submission submitted.":
        trackEvent("submission_submitted")
        break
      case "Task created.":
        trackEvent("task_created")
        break
      case "Task status updated.":
      case "Task completed.":
        trackEvent("task_completed")
        break
    }
  }, [message])

  return null
}
