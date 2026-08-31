import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe split settings geometry while preferences stream. */
export default function SettingsLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Settings"
      label="Loading settings"
      variant="split"
    />
  )
}
