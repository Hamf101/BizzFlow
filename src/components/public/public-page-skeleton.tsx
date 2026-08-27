import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Outer shells matching each unauthenticated route's own layout, so the
 * skeleton occupies the same space the loaded page will.
 */
const SHELLS = {
  /** Signing page: a wide two-column workspace on `bg-background`. */
  wide: "flex min-h-screen justify-center bg-background px-4 py-8 sm:py-12",
  /** Public form: a single centred column on `bg-muted/20`. */
  form: "flex min-h-screen justify-center bg-muted/20 px-4 py-8",
  /** Confirmation screens: one vertically centred card. */
  card: "flex min-h-screen items-center justify-center bg-muted/20 p-4",
  /** Already inside a layout that paints the page shell — no background. */
  panel: "flex w-full items-center justify-center",
} as const

const WIDTHS = {
  wide: "max-w-6xl",
  form: "max-w-2xl",
  card: "max-w-md",
  panel: "max-w-md",
} as const

type PublicPageSkeletonProps = {
  variant: keyof typeof SHELLS
}

/**
 * Placeholder shown while an unauthenticated page's server data loads.
 *
 * These routes all do async work — resolving a token, reading a template, or
 * previewing an invite — so without a boundary the browser sits on a blank
 * document until the server responds.
 *
 * @param props - Which route shell the skeleton should imitate.
 * @returns A pulsing placeholder sized to that shell.
 */
export function PublicPageSkeleton({
  variant,
}: PublicPageSkeletonProps): ReactElement {
  return (
    <div aria-label="Loading" className={SHELLS[variant]} role="status">
      <div className={cn("flex w-full flex-col gap-4", WIDTHS[variant])}>
        <div className="h-6 w-40 max-w-full animate-pulse rounded-md bg-muted" />
        <div className="h-64 animate-pulse rounded-[14px] border border-border/60 bg-card" />
        {variant === "wide" && (
          <div className="h-40 animate-pulse rounded-[14px] border border-border/60 bg-card" />
        )}
      </div>
      <span className="sr-only">Loading page</span>
    </div>
  )
}
