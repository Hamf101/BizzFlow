import type { ReactElement } from "react"

import { DashboardContentSkeleton } from "@/components/dashboard/dashboard-content-skeleton"

/**
 * Instant skeleton shown inside the dashboard panel while a page's server data
 * loads, so navigation feels immediate instead of frozen on the previous page.
 *
 * @returns A pulsing placeholder that mirrors the standard page layout.
 */
export default function DashboardLoading(): ReactElement {
  return <DashboardContentSkeleton />
}
