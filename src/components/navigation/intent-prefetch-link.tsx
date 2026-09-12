"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import type {
  ComponentProps,
  FocusEvent,
  MouseEvent,
  ReactElement,
  SyntheticEvent,
  TouchEvent,
} from "react"

export type IntentPrefetchLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "prefetch"
> & {
  href: string
}

/**
 * Fully prefetches a dashboard destination and refreshes it after user intent.
 *
 * Primary navigation contains a small, permission-filtered route set. Loading
 * those destinations while the navigation is visible lets tab switches resolve
 * from the client cache without showing an intermediate loading screen.
 *
 * @param props - Standard Next.js link props with a string application path.
 * @returns A client-navigation link that warms its route on hover, focus, or touch.
 */
export function IntentPrefetchLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps): ReactElement {
  const router = useRouter()

  function prefetchRoute(event: SyntheticEvent<HTMLAnchorElement>): void {
    if (!event.defaultPrevented) {
      router.prefetch(href)
    }
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>): void {
    onFocus?.(event)
    prefetchRoute(event)
  }

  function handleMouseEnter(event: MouseEvent<HTMLAnchorElement>): void {
    onMouseEnter?.(event)
    prefetchRoute(event)
  }

  function handleTouchStart(event: TouchEvent<HTMLAnchorElement>): void {
    onTouchStart?.(event)
    prefetchRoute(event)
  }

  return (
    <Link
      {...props}
      href={href}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      prefetch
    />
  )
}
