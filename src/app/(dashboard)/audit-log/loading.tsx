import type { ReactElement } from "react"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"

/** Shows safe event-list geometry while the audit log streams. */
export default function AuditLogLoading(): ReactElement {
  return (
    <DashboardRouteLoading
      context="Audit log"
      label="Loading audit log"
      variant="list"
    />
  )
}
