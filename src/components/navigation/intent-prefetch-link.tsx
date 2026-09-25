"use client"

import Link from "next/link"
import {
  type ComponentProps,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type SyntheticEvent,
  type TouchEvent,
  useState,
} from "react"

export type IntentPrefetchLinkProps = Omit<
  ComponentProps<typeof Link>,
  "href" | "prefetch"
> & {
  href: string
}

/**
 * A dashboard destination that loads in full once someone heads for it, on
 * hover, focus or touch. A tab that is merely on screen loads nothing, so a
 * page view pays for one page rather than every tab in the navigation, while
 * the tab someone reaches for still opens without a loading state.
 *
 * @param props - Standard Next.js link props with a string application path.
 * @returns A client-navigation link that loads its route on intent.
 */
export function IntentPrefetchLink({
  href,
  onFocus,
  onMouseEnter,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps): ReactElement {
  const [intent, setIntent] = useState(false)

  function notice(event: SyntheticEvent<HTMLAnchorElement>): void {
    if (!event.defaultPrevented) {
      setIntent(true)
    }
  }

  return (
    <Link
      {...props}
      href={href}
      onFocus={(event: FocusEvent<HTMLAnchorElement>): void => {
        onFocus?.(event)
        notice(event)
      }}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>): void => {
        onMouseEnter?.(event)
        notice(event)
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>): void => {
        onTouchStart?.(event)
        notice(event)
      }}
      prefetch={intent}
    />
  )
}
