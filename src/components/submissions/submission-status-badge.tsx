import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import type { SubmissionStatus } from "@/types/submission"

type SubmissionStatusPresentation = {
  label: string
  variant: "accent" | "default" | "destructive" | "outline" | "secondary" | "success" | "warning"
}

const SUBMISSION_STATUS_PRESENTATIONS: Record<
  SubmissionStatus,
  SubmissionStatusPresentation
> = {
  // One look per status: no two read alike at a glance.
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "accent" },
  in_review: { label: "In review", variant: "default" },
  needs_changes: { label: "Needs changes", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
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

/**
 * Names a submission status the way every submission screen spells it.
 *
 * @param status - Current submission review status.
 * @returns The status's human-readable label.
 */
export function getSubmissionStatusLabel(status: SubmissionStatus): string {
  return SUBMISSION_STATUS_PRESENTATIONS[status].label
}
