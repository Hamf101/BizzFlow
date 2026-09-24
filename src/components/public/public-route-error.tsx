"use client"

import { useEffect, type ReactElement } from "react"

import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/page-state"
import { captureUnexpectedError } from "@/lib/observability"

type PublicRouteErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Outer shells for the boundary. `page` paints its own full-height background;
 * `panel` is for segments already inside a layout that paints one.
 */
const SHELLS = {
  page: "flex min-h-screen items-center justify-center bg-background px-4 py-10",
  panel: "flex w-full items-center justify-center",
} as const

/**
 * Builds the error boundary shared by BizFlow's unauthenticated routes.
 *
 * A factory rather than a `boundary` prop because Next.js renders `error.tsx`'s
 * default export directly: each route calls this once at module scope, so the
 * Sentry report still names the segment that failed.
 *
 * Recipients of a signing or form link have no navigation to fall back on, so
 * the panel offers a retry and says nothing about why the failure happened.
 *
 * @param boundary - Route segment recorded alongside the captured error.
 * @param shell - Whether the segment paints its own page background.
 * @returns An error boundary component for that segment.
 */
export function createPublicRouteErrorBoundary(
  boundary: string,
  shell: keyof typeof SHELLS = "page"
): (props: PublicRouteErrorProps) => ReactElement {
  function PublicRouteError({
    error,
    reset,
  }: PublicRouteErrorProps): ReactElement {
    useEffect(() => {
      captureUnexpectedError(error, { boundary })
    }, [error])

    return (
      <div className={SHELLS[shell]}>
        <div className="w-full max-w-md">
          <ErrorState
            action={
              <Button onClick={reset} size="sm" variant="secondary">
                Try again
              </Button>
            }
            description="Try again. If the problem continues, ask your contact for a new link."
            title="This page didn’t load."
          />
        </div>
      </div>
    )
  }

  PublicRouteError.displayName = `PublicRouteError(${boundary})`

  return PublicRouteError
}
