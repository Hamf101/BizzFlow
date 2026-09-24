"use client"

import Link from "next/link"
import { useEffect, type ComponentType, type ReactElement } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { ErrorState } from "@/components/ui/page-state"
import { captureUnexpectedError } from "@/lib/observability"
import { cn } from "@/lib/utils"

export type DashboardErrorBoundaryProps = {
  error: Error & { digest?: string }
  reset: () => void
}

type DashboardRouteErrorProps = DashboardErrorBoundaryProps & {
  boundary: string
  routeName: string
}

/**
 * Reports a dashboard route failure and renders only fixed recovery copy.
 *
 * @param props - Fixed route identity plus Next's original error and reset callback.
 * @returns An unframed Quiet Continuity recovery surface.
 */
export function DashboardRouteError({
  boundary,
  error,
  reset,
  routeName,
}: DashboardRouteErrorProps): ReactElement {
  useEffect(() => {
    captureUnexpectedError(error, { boundary })
  }, [boundary, error])

  return (
    <div className="grid max-w-3xl gap-4">
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
        {routeName}
      </span>
      <ErrorState
        action={
          <div className="flex flex-col gap-1 sm:flex-row">
            <Button onClick={reset} type="button" variant="secondary">
              Try again
            </Button>
            <Link
              className={cn(buttonVariants({ variant: "ghost" }))}
              href="/dashboard"
            >
              Return to dashboard
            </Link>
          </div>
        }
        description="Try again, or return to the dashboard."
        title={`${routeName} didn’t load.`}
      />
    </div>
  )
}

/** Creates the fixed route wrapper required by a Next.js `error.tsx` file. */
function createDashboardRouteErrorBoundary(
  boundary: string,
  routeName: string
): ComponentType<DashboardErrorBoundaryProps> {
  function RouteErrorBoundary(
    props: DashboardErrorBoundaryProps
  ): ReactElement {
    return (
      <DashboardRouteError
        {...props}
        boundary={boundary}
        routeName={routeName}
      />
    )
  }

  RouteErrorBoundary.displayName = `${routeName}RouteError`
  return RouteErrorBoundary
}

export const DashboardPageError = createDashboardRouteErrorBoundary(
  "dashboard",
  "Dashboard"
)
export const DocumentsPageError = createDashboardRouteErrorBoundary(
  "documents",
  "Files"
)
export const TemplatesPageError = createDashboardRouteErrorBoundary(
  "templates",
  "Templates"
)
export const SubmissionsPageError = createDashboardRouteErrorBoundary(
  "submissions",
  "Submissions"
)
export const TasksPageError = createDashboardRouteErrorBoundary("tasks", "Tasks")
export const PeoplePageError = createDashboardRouteErrorBoundary(
  "people",
  "People"
)
export const AuditLogPageError = createDashboardRouteErrorBoundary(
  "audit_log",
  "Audit log"
)
export const SettingsPageError = createDashboardRouteErrorBoundary(
  "settings",
  "Settings"
)
