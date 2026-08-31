import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe task-list geometry while the workspace streams. */
export default function TasksLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Tasks"
      label="Loading tasks"
      variant="list"
    />
  )
}
