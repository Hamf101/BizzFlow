import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import type { SubmissionStatus } from "@/types/submission"

type SubmissionStatusPresentation = {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
}

const SUBMISSION_STATUS_PRESENTATIONS: Record<
  SubmissionStatus,
  SubmissionStatusPresentation
> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Submitted", variant: "default" },
  in_review: { label: "In review", variant: "outline" },
  needs_changes: { label: "Needs changes", variant: "destructive" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  completed: { label: "Completed", variant: "secondary" },
}

/**
 * Renders the compact submission review lifecycle label.
 *
 * @param props - Current submission review status.
 * @returns Status badge with a stable human-readable label.
 */
export function SubmissionStatusBadge({
  status,
}: {
  status: SubmissionStatus
}): ReactElement {
  const presentation = SUBMISSION_STATUS_PRESENTATIONS[status]

  return (
    <Badge variant={presentation.variant}>{presentation.label}</Badge>
  )
}
