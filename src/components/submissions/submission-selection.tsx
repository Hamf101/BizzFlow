"use client"

import { Check, UserRoundCheck } from "lucide-react"
import { type ReactElement, type ReactNode, useState, useTransition } from "react"

import { reviewSubmissionsAction, type SubmissionReviewChange } from "@/app/(dashboard)/submissions/actions"
import { BAR_BUTTON, SelectionBarShell } from "@/components/data/selection-bar"
import { SelectableItem, SelectionProvider, useOpensOnRightClick, useSelection } from "@/components/data/selection"
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { announceChange, bizflowToast } from "@/components/ui/toaster"
import type { SubmissionStatus } from "@/types/submission"

/** One submission the list shows, with what decides the steps it can take. */
export type SelectableSubmission = { id: string; revision: number; status: SubmissionStatus }

type Change = SubmissionReviewChange["change"]

// Each step and the submissions it applies to: the rest of a selection is left be.
type Step = { change: Change; done: string; icon: typeof Check; label: string; takes: SubmissionStatus }

const STEPS: readonly Step[] = [
  { change: "start", done: "taken on for review", icon: UserRoundCheck, label: "Start review", takes: "submitted" },
  { change: "approve", done: "approved", icon: Check, label: "Approve", takes: "in_review" },
]

/**
 * Keeps the list's selection (see SelectionProvider) for a reviewer.
 *
 * @param props - Every submission on the page, in order.
 * @returns The selection around the list.
 */
export function SubmissionSelection({ children, submissions }: { children: ReactNode; submissions: readonly SelectableSubmission[] }): ReactElement {
  return (
    <SelectionProvider items={submissions} scope="submissions" shown={submissions.map((submission) => submission.id)}>
      {children}
    </SelectionProvider>
  )
}

/**
 * A submission row that joins the selection (see SelectableItem).
 *
 * @param props - The row to draw, its submission, and its own attributes.
 * @returns The row.
 */
export function SelectableSubmissionRow(props: Omit<Parameters<typeof SelectableItem>[0], "checkSlot" | "slot">): ReactElement {
  return <SelectableItem {...props} checkSlot="submission-check" slot="submission-row" />
}

// The steps the selection can take, and how to take one.
function useReviewSteps(): { pending: boolean; run: (step: Step) => void; steps: Step[]; targets: SelectableSubmission[] } {
  const selection = useSelection<SelectableSubmission>()
  const targets = selection ? selection.items.filter((submission) => selection.selected.has(submission.id)) : []
  const [pending, startTransition] = useTransition()

  function run(step: Step): void {
    const items = targets.filter((submission) => submission.status === step.takes).map(({ id, revision }) => ({ id, revision }))

    startTransition(async () => {
      try {
        const { changed, failed } = await reviewSubmissionsAction({ change: step.change, items })
        const count = changed.length
        announceChange(`${failed > 0 ? `${count} of ${count + failed}` : count} ${count + failed === 1 ? "submission" : "submissions"} ${step.done}`, failed, null)
        selection?.clear()
      } catch {
        bizflowToast.error("Those submissions could not be changed", { description: "Reload the page and try again." })
      }
    })
  }

  return { pending, run, steps: STEPS.filter((step) => targets.some((submission) => submission.status === step.takes)), targets }
}

function describe(step: Step, targets: readonly SelectableSubmission[]): string {
  const count = targets.filter((submission) => submission.status === step.takes).length
  return count === targets.length ? step.label : `${step.label} (${count} of ${targets.length})`
}

/**
 * The bar a selection raises: start the submitted ones, approve the ones in
 * review, each counted when the service refuses it.
 *
 * @returns The selection bar.
 */
export function SubmissionSelectionBar(): ReactElement {
  const { pending, run, steps, targets } = useReviewSteps()
  const open = targets.length > 0
  // What the bar last showed, so it keeps its words while it sinks away.
  const [shown, setShown] = useState({ count: 0, steps: [] as Step[] })

  if (open && (shown.count !== targets.length || shown.steps.map((step) => step.change).join() !== steps.map((step) => step.change).join())) {
    setShown({ count: targets.length, steps })
  }

  return (
    <SelectionBarShell count={shown.count} onClear={useSelection()?.clear} open={open}>
      {shown.steps.map((step) => (
        <button aria-label={describe(step, targets)} className={BAR_BUTTON} disabled={pending} key={step.change} onClick={() => run(step)} type="button">
          <step.icon aria-hidden="true" className="size-4 opacity-80" />
          <span className="max-md:hidden">{step.label}</span>
        </button>
      ))}
    </SelectionBarShell>
  )
}

/**
 * A row's right-click menu: the same steps as the bar, for the selection the
 * right-click made or joined.
 *
 * @returns The menu, inside a selectable row.
 */
export function SubmissionRowMenu(): ReactElement | null {
  const opensOnRightClick = useOpensOnRightClick()
  const { pending, run, steps, targets } = useReviewSteps()

  if (!opensOnRightClick) {
    return null
  }

  return (
    <DropdownMenuContent className="w-52">
      {steps.length > 0 ? (
        steps.map((step) => (
          <DropdownMenuItem disabled={pending} key={step.change} onClick={() => run(step)}>
            <step.icon aria-hidden="true" />
            {describe(step, targets)}
          </DropdownMenuItem>
        ))
      ) : (
        <DropdownMenuItem disabled>Nothing to start or approve</DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
}
