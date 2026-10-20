import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Flow's tab icon: its floating button, small, a swarm of dots that turns on
 * hover (the motion lives in globals.css, under "Nav icons").
 */
export function FlowIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg aria-hidden="true" className={cn("nav-icon", className)} fill="currentColor" height="24" viewBox="0 0 24 24" width="24">
      <g data-move="swarm">
        <circle cx="12" cy="12" r="2.7" />
        <circle cx="12" cy="4.2" r="2" />
        <circle cx="18.8" cy="8" r="1.7" />
        <circle cx="18.8" cy="16" r="2.1" />
        <circle cx="12" cy="19.8" r="1.6" />
        <circle cx="5.2" cy="16" r="1.9" />
        <circle cx="5.2" cy="8" r="1.5" />
      </g>
    </svg>
  )
}
