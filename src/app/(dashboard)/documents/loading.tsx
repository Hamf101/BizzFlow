import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe document-list geometry while the workspace streams. */
export default function DocumentsLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Documents"
      label="Loading documents"
      variant="list"
    />
  )
}
