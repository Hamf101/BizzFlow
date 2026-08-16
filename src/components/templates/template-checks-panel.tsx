import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react"
import type { ReactElement } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  evaluateTemplateQuality,
  type TemplateQualityIssue
} from "@/services/templates/template-quality-service"
import type { TemplateContent } from "@/types/template"

type TemplateChecksPanelProps = {
  content: TemplateContent
  description: string
  title: string
  onSelectBlock: (blockId: string) => void
}

/**
 * Shows the deterministic server-equivalent usability checks inside Studio.
 *
 * @param props - Current metadata/content and a block navigation callback.
 * @returns Critical and warning findings with direct block navigation.
 */
export function TemplateChecksPanel({
  content,
  description,
  title,
  onSelectBlock
}: TemplateChecksPanelProps): ReactElement {
  const evaluation = evaluateTemplateQuality({
    title,
    description,
    content
  })

  if (evaluation.issues.length === 0) {
    return (
      <div className="grid justify-items-center gap-3 rounded-lg border border-border bg-card p-6 text-center">
        <CircleCheck className="text-primary" />
        <div>
          <h3 className="text-sm font-semibold">Ready for review</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            No deterministic usability problems were found.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="destructive">
          {evaluation.summary.criticalCount} critical
        </Badge>
        <Badge variant="outline">
          {evaluation.summary.warningCount} warnings
        </Badge>
      </div>
      <ol className="grid gap-2">
        {evaluation.issues.map((issue: TemplateQualityIssue) => (
          <li
            className="rounded-lg border border-border bg-card p-3"
            key={issue.code}
          >
            <div className="flex items-start gap-2">
              {issue.severity === "critical" ? (
                <CircleAlert className="mt-0.5 text-destructive" />
              ) : (
                <TriangleAlert className="mt-0.5 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {formatIssueCode(issue.code)}
                  </span>
                  <Badge variant="outline">{issue.severity}</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {issue.message}
                </p>
                {issue.affectedBlockIds[0] && (
                  <Button
                    className="mt-2"
                    onClick={(): void =>
                      onSelectBlock(issue.affectedBlockIds[0] as string)
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Show element
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function formatIssueCode(code: TemplateQualityIssue["code"]): string {
  const words = code.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}
