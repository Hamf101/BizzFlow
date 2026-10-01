import { ArrowRight, Check, X } from "lucide-react"
import type { ReactElement } from "react"

import { decideSuggestionAction } from "@/app/(dashboard)/submissions/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatMediumDateTime } from "@/lib/date-format"
import type { OrganizationMember } from "@/types/organization"
import type { Submission } from "@/types/submission"
import type { SubmissionSuggestion } from "@/types/submission-review"

const OPEN_STATUSES: readonly Submission["status"][] = ["submitted", "in_review", "needs_changes"]

/**
 * Says how an answer reads: a tick box as ticked or not, and a blank as blank.
 *
 * @param value - The answer.
 * @returns Words for it.
 */
export function describeAnswer(value: string | boolean | null): string {
  if (typeof value === "boolean") return value ? "Ticked" : "Not ticked"

  return value?.trim() ? value : "Blank"
}

/**
 * The change trail: every answer a reviewer suggested, what it was, what they
 * suggested, and whether the person who submitted it accepted. They alone see
 * Accept and Decline, while it is still being reviewed.
 *
 * @param props - The suggestions, the submission, who is looking, and the members.
 * @returns The card, or nothing when nothing was suggested.
 */
export function SubmissionSuggestions({
  currentUserId,
  members,
  submission,
  suggestions,
}: {
  currentUserId: string
  members: readonly OrganizationMember[]
  submission: Submission
  suggestions: readonly SubmissionSuggestion[]
}): ReactElement | null {
  if (suggestions.length === 0) {
    return null
  }

  const labels = new Map(
    submission.templateSnapshot.blocks.flatMap((block) => ("fieldKey" in block && "label" in block ? [[block.fieldKey, block.label] as const] : []))
  )
  const names = new Map(members.map((member) => [member.userId, member.fullName?.trim() || member.email]))
  const decides = submission.createdBy === currentUserId && OPEN_STATUSES.includes(submission.status)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested changes</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {suggestions.map((suggestion) => {
            const by = suggestion.suggestedBy ? names.get(suggestion.suggestedBy) ?? "A team member" : "A former member"
            const open = suggestion.status === "pending"

            return (
              <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" key={suggestion.id}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium">{labels.get(suggestion.fieldKey) ?? suggestion.fieldKey}</span>
                  <Badge variant={suggestion.status === "accepted" ? "default" : suggestion.status === "declined" ? "secondary" : "outline"}>
                    {suggestion.status === "accepted" ? "Accepted" : suggestion.status === "declined" ? "Declined" : OPEN_STATUSES.includes(submission.status) ? "Waiting" : "Not decided"}
                  </Badge>
                </div>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="break-words text-muted-foreground line-through decoration-muted-foreground/50">{describeAnswer(suggestion.previousValue)}</span>
                  <ArrowRight aria-label="changed to" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="break-words">{describeAnswer(suggestion.proposedValue)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {by} · {formatMediumDateTime(suggestion.suggestedAt)}
                </p>
                {open && decides ? (
                  <form action={decideSuggestionAction} className="flex flex-wrap gap-2">
                    <input name="submissionId" type="hidden" value={submission.id} />
                    <input name="suggestionId" type="hidden" value={suggestion.id} />
                    <Button name="decision" size="sm" type="submit" value="accept">
                      <Check />
                      Accept
                    </Button>
                    <Button name="decision" size="sm" type="submit" value="decline" variant="outline">
                      <X />
                      Decline
                    </Button>
                  </form>
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
