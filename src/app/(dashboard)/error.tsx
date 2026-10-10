"use client"

import { usePathname } from "next/navigation"
import type { ReactElement } from "react"

import {
  DashboardRouteError,
  type DashboardErrorBoundaryProps,
} from "@/components/dashboard/dashboard-route-error"

/** Each dashboard section's name, by its first path segment. */
const SECTION_NAMES: Readonly<Record<string, string>> = {
  "audit-log": "Audit log",
  dashboard: "Dashboard",
  documents: "Files",
  people: "People",
  settings: "Settings",
  submissions: "Submissions",
  tasks: "Tasks",
  templates: "Templates",
}

/**
 * Dashboard error boundary that keeps the shell visible and names the section
 * that failed.
 *
 * @param props - Next.js error boundary props.
 * @returns A recovery panel for the failed section.
 */
export default function DashboardError(
  props: DashboardErrorBoundaryProps
): ReactElement {
  const segment = usePathname().split("/")[1] ?? ""
  const known = Object.hasOwn(SECTION_NAMES, segment)

  return (
    <DashboardRouteError
      {...props}
      boundary={known ? segment.replace("-", "_") : "dashboard"}
      routeName={known ? SECTION_NAMES[segment] : "Dashboard"}
    />
  )
}
