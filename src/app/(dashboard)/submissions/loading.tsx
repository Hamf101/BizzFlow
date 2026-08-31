import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe submission-list geometry while the workspace streams. */
export default function SubmissionsLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Submissions"
      label="Loading submissions"
      variant="list"
    />
  )
}
