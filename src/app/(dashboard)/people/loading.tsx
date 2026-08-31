import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe people-list geometry while the workspace streams. */
export default function PeopleLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="People"
      label="Loading people"
      variant="list"
    />
  )
}
