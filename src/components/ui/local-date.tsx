"use client"

import { type ReactElement, useEffect, useSyncExternalStore } from "react"

import { formatMediumDate, formatMediumDateTime, TIME_ZONE_COOKIE } from "@/lib/date-format"
import { subscribeNever } from "@/lib/utils"

function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The viewer's time zone. The server can't know it, so the server's page and
 * the browser taking it over both use UTC, and the dates then turn to the
 * viewer's own: the two never disagree, and nobody is shown another zone's day.
 *
 * @returns An IANA time zone.
 */
export function useTimeZone(): string {
  return useSyncExternalStore(subscribeNever, viewerTimeZone, () => "UTC")
}

/**
 * Tells the server the viewer's time zone, for the pages it words, such as
 * the dashboard's "yesterday".
 *
 * @returns Nothing to draw.
 */
export function TimeZoneCookie(): null {
  useEffect(() => {
    const cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(viewerTimeZone())}`

    if (!document.cookie.split("; ").includes(cookie)) {
      document.cookie = `${cookie}; path=/; max-age=31536000; samesite=lax`
    }
  }, [])

  return null
}

/**
 * A date, or a date and time, in the viewer's time zone, for a page the server draws.
 *
 * @param props - The ISO value, and whether the time is shown too.
 * @returns The formatted text.
 */
export function LocalDate({ time = false, value }: { time?: boolean; value: string }): ReactElement {
  const timeZone = useTimeZone()

  return <>{time ? formatMediumDateTime(value, timeZone) : formatMediumDate(value, timeZone)}</>
}
