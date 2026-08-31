import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe dashboard geometry while its server data streams. */
export default function DashboardLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Dashboard"
      label="Loading dashboard"
      variant="overview"
    />
  )
}
