import type { ReactElement } from "react"

import { PageSkeleton } from "@/components/ui/page-state"

/**
 * Placeholder shown inside the dashboard panel while a page's server data
 * streams in, so the shell paints immediately instead of blocking on a fetch.
 *
 * Shared by the route-level `loading.tsx` and the layout's Suspense boundary so
 * a navigation and a first render show the same shape.
 *
 * @returns A pulsing placeholder mirroring the standard page layout.
 */
export function DashboardContentSkeleton(): ReactElement {
  return (
    <PageSkeleton
      context="Workspace"
      label="Loading page"
      variant="overview"
    />
  )
}
