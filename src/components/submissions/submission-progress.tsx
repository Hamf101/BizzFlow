import {
  ArrowDownToLine,
  Check,
  CircleCheck,
  Eye,
  type LucideIcon,
  MessageSquareWarning,
  PencilLine,
  X,
} from "lucide-react"
import type { ReactElement } from "react"

import { getSubmissionStatusLabel } from "@/components/submissions/submission-status-badge"
import { cn } from "@/lib/utils"
import type { SubmissionStatus } from "@/types/submission"

/** Draft, submitted, in review, decided, completed. */
const LIFECYCLE_STEPS = 5

type SubmissionStatusLook = {
  icon: LucideIcon
  /** Where the status sits on the lifecycle track. */
  step: number
  /** Colour of the status icon and of the track's filled steps. */
  tone: string
}

const SUBMISSION_STATUS_LOOKS: Record<SubmissionStatus, SubmissionStatusLook> = {
  draft: { icon: PencilLine, step: 1, tone: "text-muted-foreground" },
  submitted: { icon: ArrowDownToLine, step: 2, tone: "text-primary" },
  in_review: { icon: Eye, step: 3, tone: "text-primary" },
  needs_changes: { icon: MessageSquareWarning, step: 3, tone: "text-warning" },
  approved: { icon: Check, step: 4, tone: "text-success" },
  rejected: { icon: X, step: 4, tone: "text-destructive" },
  completed: { icon: CircleCheck, step: 5, tone: "text-success" },
}

/**
 * Leads a submission row with a bare icon, in its status colour, that shows
 * its status.
 *
 * The status is spelled out under the progress track, so the icon is only
 * decoration to assistive technology. It keeps a fixed slot, so every title
 * starts on the same line.
 *
 * @param props - Current submission review status.
 * @returns The status icon.
 */
export function SubmissionStatusMark({
  status,
}: {
  status: SubmissionStatus
}): ReactElement {
  const look = SUBMISSION_STATUS_LOOKS[status]
  const Icon = look.icon

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-[30px] shrink-0 place-items-center [&_svg]:size-[18px]",
        look.tone
      )}
      data-slot="submission-status-mark"
    >
      <Icon />
    </span>
  )
}

/**
 * Shows how far a submission has come as a five-step track, with its status
 * and step spelled out beneath. Phones keep only the status word in view.
 *
 * @param props - Current submission review status.
 * @returns The lifecycle track and its label.
 */
export function SubmissionProgress({
  status,
}: {
  status: SubmissionStatus
}): ReactElement {
  const look = SUBMISSION_STATUS_LOOKS[status]

  return (
    <span
      className={cn("grid min-w-0 gap-1.5", look.tone)}
      data-slot="submission-progress"
    >
      <span aria-hidden="true" className="grid grid-cols-5 gap-[3px]">
        {Array.from({ length: LIFECYCLE_STEPS }, (_, step: number) => (
          <span
            className={cn(
              "h-1 rounded-full",
              step < look.step ? "bg-current" : "bg-border"
            )}
            key={step}
          />
        ))}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {getSubmissionStatusLabel(status)}
        <span className="max-lg:sr-only">
          {` · step ${look.step} of ${LIFECYCLE_STEPS}`}
        </span>
      </span>
    </span>
  )
}
