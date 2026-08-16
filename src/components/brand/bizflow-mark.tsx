import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

type BizFlowMarkProps = {
  className?: string
}

/**
 * Renders BizFlow's page-fold and flowing-line brand mark.
 *
 * @param props - Optional classes used to size or color the mark.
 * @returns An accessible, current-color SVG brand mark.
 */
export function BizFlowMark({ className }: BizFlowMarkProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-7", className)}
      fill="none"
      viewBox="0 0 32 32"
    >
      <path
        d="M8.5 4.5h10.25L24 9.75V26a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 7 26V6a1.5 1.5 0 0 1 1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M18.5 4.75V10h5.25"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M11 14.25c2.2-2 4.45-2 6.75 0s4.55 2 6.75 0M11 19c2.2-2 4.45-2 6.75 0s4.55 2 6.75 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

type BizFlowWordmarkProps = {
  compact?: boolean
}

/**
 * Renders the shared product wordmark with the custom BizFlow mark.
 *
 * @param props - Whether to hide the supporting product descriptor.
 * @returns A compact mark and wordmark lockup.
 */
export function BizFlowWordmark({
  compact = false,
}: BizFlowWordmarkProps): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-[10px] border border-primary/15 bg-secondary text-primary shadow-[0_1px_0_rgba(37,35,41,0.05)]">
        <BizFlowMark className="size-6" />
      </span>
      <span className="flex flex-col">
        <span className="font-editorial text-xl font-semibold leading-none tracking-[-0.02em]">
          BizFlow
        </span>
        {!compact && (
          <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Document studio
          </span>
        )}
      </span>
    </div>
  )
}
