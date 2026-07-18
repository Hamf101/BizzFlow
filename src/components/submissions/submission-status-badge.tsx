import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import type { SubmissionStatus } from "@/types/submission"

/**
 * Renders the compact Sprint 7 submission lifecycle label.
 *
 * @param props - Current draft or submitted status.
 * @returns Status badge with a stable human-readable label.
 */
export function SubmissionStatusBadge({
  status,
}: {
  status: SubmissionStatus
}): ReactElement {
  return (
    <Badge variant={status === "submitted" ? "default" : "secondary"}>
      {status === "submitted" ? "Submitted" : "Draft"}
    </Badge>
  )
}
