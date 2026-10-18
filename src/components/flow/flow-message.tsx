import type { ReactElement, ReactNode } from "react"

import { PIECE_STYLE, PIECES } from "@/components/flow/flow-window"
import { cn } from "@/lib/utils"

// Flow's button, small: seams thick enough to see at this size.
const MARK = PIECES.map((piece) => ({ points: piece.points.join(" "), style: { ...PIECE_STYLE(piece.tone, piece.strength), strokeWidth: 12 } }))

/**
 * One turn in a Flow conversation: the member's words in a plum bubble on the
 * right, Flow's on the left beside its folded page, as a chat reads.
 *
 * @param props - Who spoke, an optional heading over a member's run, and what was said.
 * @returns The turn as a list item.
 */
export function FlowMessage({
  author,
  children,
  failed = false,
  from,
}: {
  /** Shown over the first of a run of one member's messages. */
  author?: ReactNode
  children: ReactNode
  failed?: boolean
  from: "flow" | "member"
}): ReactElement {
  if (from === "member") {
    return (
      <li className="grid justify-items-end gap-1">
        {author ? <span className="flex gap-2 px-1 text-[11px] text-muted-foreground">{author}</span> : null}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
          {children}
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2.5">
      <span className="sr-only">Flow</span>
      {/* Deeper tones at night, so the mark reads on the dark window. */}
      <svg aria-hidden="true" className="mt-0.5 h-7 w-[22px] shrink-0 dark:[--fold-strength:0.8]" viewBox="-180 -230 360 460">
        {MARK.map((piece, index) => (
          <polygon key={index} points={piece.points} style={piece.style} />
        ))}
      </svg>
      <div className={cn("min-w-0 flex-1 text-sm leading-relaxed", failed && "text-destructive")}>{children}</div>
    </li>
  )
}
