"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef } from "react"

import { bizflowToast } from "@/components/ui/toaster"
import { trackEvent } from "@/lib/analytics"
import { getActionFeedback } from "@/lib/action-feedback"

/**
 * Consumes one stable dashboard feedback code into toast and analytics channels.
 *
 * Unknown URL values are removed without display or tracking. Known values resolve
 * only through the fixed registry, then the consumed parameter is removed with a
 * history replacement while other route state and the hash remain intact.
 *
 * @returns Nothing; this component exists only for its navigation side effects.
 */
export function ActionFeedback(): null {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const consumedKeyRef = useRef<string | null>(null)
  const serializedParams = searchParams.toString()
  const feedbackValue = searchParams.get("feedback")

  useEffect(() => {
    if (feedbackValue === null) {
      consumedKeyRef.current = null
      return
    }

    const hash = window.location.hash
    const consumptionKey = `${pathname}?${serializedParams}${hash}`

    if (consumedKeyRef.current === consumptionKey) {
      return
    }
    consumedKeyRef.current = consumptionKey

    const feedback = getActionFeedback(feedbackValue)
    if (feedback) {
      bizflowToast[feedback.tone](feedback.title, {
        ...(feedback.description
          ? { description: feedback.description }
          : {}),
        duration: feedback.persistent ? Infinity : feedback.durationMs,
      })
      trackEvent(feedback.analyticsEvent, {
        outcomeCode: feedback.code,
        route: pathname,
      })
    }

    const nextParams = new URLSearchParams(serializedParams)
    nextParams.delete("feedback")
    const query = nextParams.toString()
    const destination = `${pathname}${query ? `?${query}` : ""}${hash}`

    router.replace(destination, { scroll: false })
  }, [feedbackValue, pathname, router, serializedParams])

  return null
}
