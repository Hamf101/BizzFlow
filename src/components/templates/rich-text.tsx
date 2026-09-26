import { type CSSProperties, Fragment, type ReactNode } from "react"

import type { TextRun } from "@/types/template"

/**
 * Text as the toolbar left it: each formatted stretch in its own span, and
 * links opening in a new tab that gets no hold on this page. Sizes are points
 * of the printed page, so a surface sets `--doc-pt` to how many pixels a point
 * takes there. Text with no formatting stays plain text.
 *
 * @param props - The text, and its formatting when it has any.
 * @returns The text.
 */
export function RichText({ runs, text }: { runs?: readonly TextRun[] | null; text: string }): ReactNode {
  if (!runs?.length) {
    return text
  }

  return runs.map((run: TextRun, index: number): ReactNode => {
    const lines = [run.underline && "underline", run.strike && "line-through"].filter(Boolean).join(" ")
    const style: CSSProperties = {
      backgroundColor: run.highlight,
      color: run.color,
      fontSize: run.size ? `calc(var(--doc-pt, 1.4px) * ${run.size})` : undefined,
      fontStyle: run.italic ? "italic" : undefined,
      fontWeight: run.bold ? 700 : undefined,
      textDecorationLine: lines || undefined,
    }

    if (!run.link && Object.values(style).every((value) => value === undefined)) {
      return <Fragment key={index}>{run.text}</Fragment>
    }

    return run.link ? (
      <a className="underline underline-offset-2" href={run.link} key={index} rel="noopener noreferrer" style={style} target="_blank">
        {run.text}
      </a>
    ) : (
      <span key={index} style={style}>
        {run.text}
      </span>
    )
  })
}
