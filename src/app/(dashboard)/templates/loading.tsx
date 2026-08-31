import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe template-list geometry while the workspace streams. */
export default function TemplatesLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Templates"
      label="Loading templates"
      variant="list"
    />
  )
}
