import { Check } from "lucide-react"
import type { CSSProperties, ReactElement, ReactNode } from "react"

import { PIECE_STYLE, PIECES } from "@/components/flow/flow-window"
import { cn } from "@/lib/utils"
import type { FlowStage } from "@/services/template-flow/contracts"

// Flow's button, small: seams thick enough to see at this size. While Flow
// works each piece eases out from the page's middle and back, at its own pace,
// from its own start, turning its own way, so no two ever move together.
const MARK = PIECES.map((piece, index) => {
  const spread = (step: number): number => (index * step) % 1
  const reach = 26 + spread(0.27) * 24

  return {
    points: piece.points.join(" "),
    style: {
      ...PIECE_STYLE(piece.tone, piece.strength),
      "--l": `${(-spread(0.382) * 2.4).toFixed(2)}s`,
      "--p": `${(1.6 + spread(0.618) * 1.4).toFixed(2)}s`,
      "--r": `${((index % 2 ? 1 : -1) * (6 + spread(0.73) * 8)).toFixed(1)}deg`,
      "--x": `${(piece.out[0] * reach).toFixed(1)}px`,
      "--y": `${(piece.out[1] * reach).toFixed(1)}px`,
      strokeWidth: 12,
    } as CSSProperties,
  }
})

/** What the member reads for each stage of a turn. */
const STAGE_WORDS: Readonly<Record<FlowStage, string>> = {
  checking: "Checking how it prints",
  finding: "Looking through your work",
  reading: "Reading the page",
  thinking: "Reading your message",
  tidying: "Tidying a few things",
  writing: "Drafting the changes",
}

/**
 * One turn in a Flow conversation: the member's words in a plum bubble on the
 * right, Flow's on the left beside its folded page, as a chat reads.
 *
 * @param props - Who spoke, an optional heading over a run, and what was said.
 * @returns The turn as a list item.
 */
export function FlowMessage({
  author,
  children,
  failed = false,
  from,
  speaker,
}: {
  /** Shown over the first message of a run: a member's name and time, or Flow's time. */
  author?: ReactNode
  children: ReactNode
  failed?: boolean
  from: "flow" | "member"
  /** Who wrote a member's message, read out where no heading names them. */
  speaker?: string
}): ReactElement {
  if (from === "member") {
    return (
      <li className="grid justify-items-end gap-1">
        {author ? (
          <span className="flex gap-2 px-1 text-[11px] text-muted-foreground">{author}</span>
        ) : speaker ? (
          <span className="sr-only">{speaker}</span>
        ) : null}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
          {children}
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2.5">
      <span className="sr-only">Flow</span>
      <FlowMark />
      <div className={cn("min-w-0 flex-1 text-sm leading-relaxed", failed && "text-destructive")}>
        {author ? <span className="block text-[11px] text-muted-foreground">{author}</span> : null}
        {children}
      </div>
    </li>
  )
}

/**
 * Flow at work: its mark coming gently apart, and each stage of the turn as
 * the server reaches it, the earlier ones ticked off.
 *
 * @param props - The stages reached so far, and whether Flow is reading an attached form.
 * @returns The working turn as a list item.
 */
export function FlowWorking({ readingForm = false, stages }: { readingForm?: boolean; stages: readonly FlowStage[] }): ReactElement {
  const words = (stage: FlowStage): string => (stage === "reading" && readingForm ? "Reading your form" : STAGE_WORDS[stage])
  const done = stages.slice(0, -1)
  const now = stages.at(-1)

  return (
    <li aria-busy="true" className="flex items-start gap-2.5">
      <span className="sr-only">Flow</span>
      <FlowMark working />
      <div className="grid min-w-0 flex-1 gap-0.5 text-sm leading-relaxed">
        {done.map((stage) => (
          <span className="flex items-center gap-1.5 text-muted-foreground" key={stage}>
            <Check aria-hidden="true" className="size-3.5 text-primary" />
            {words(stage)}
          </span>
        ))}
        {now ? (
          <span className="flow-working-now block" key={now}>
            {words(now)}…
          </span>
        ) : null}
      </div>
    </li>
  )
}

function FlowMark({ working = false }: { working?: boolean }): ReactElement {
  return (
    // Deeper tones at night, so the mark reads on the dark window.
    <svg
      aria-hidden="true"
      className={cn("mt-0.5 h-7 w-[22px] shrink-0 overflow-visible dark:[--fold-strength:0.8]", working && "flow-mark-working")}
      viewBox="-180 -230 360 460"
    >
      {MARK.map((piece, index) => (
        <polygon key={index} points={piece.points} style={piece.style} />
      ))}
    </svg>
  )
}
