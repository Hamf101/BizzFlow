import type { ReactElement } from "react"

import { PageSkeleton } from "@/components/ui/page-state"

type DashboardRouteLoadingProps = {
  context: string
  label: string
  variant: "list" | "overview" | "split"
}

/** Renders one approved Quiet Continuity loading state inside the dashboard shell. */
export function DashboardRouteLoading({
  context,
  label,
  variant,
}: DashboardRouteLoadingProps): ReactElement {
  return <PageSkeleton context={context} label={label} variant={variant} />
}
