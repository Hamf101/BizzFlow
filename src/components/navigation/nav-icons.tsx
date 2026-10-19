import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

/*
 * The destinations whose pages change shape have icons that do too: each
 * moves the way its page does when its link is pointed at or pressed (the
 * motion lives in globals.css, under "Nav icons"). Drawn on Lucide's grid and
 * stroke, so they sit beside its icons as one set.
 */

function NavIcon({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={cn("nav-icon", className)}
      fill="none"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
    >
      {children}
    </svg>
  )
}

/** Tiles that trade columns: the dashboard rearranges around the day. */
export function DashboardIcon({ className }: { className?: string }): ReactElement {
  return (
    <NavIcon className={className}>
      <g data-move="trade-right">
        <rect height="11" rx="2" width="8" x="3" y="3" />
        <rect height="4.5" rx="1.5" width="8" x="3" y="16.5" />
      </g>
      <g data-move="trade-left">
        <rect height="4.5" rx="1.5" width="8" x="13" y="3" />
        <rect height="11" rx="2" width="8" x="13" y="10" />
      </g>
    </NavIcon>
  )
}

/** A sheet dropping into the tray. */
export function SubmissionsIcon({ className }: { className?: string }): ReactElement {
  return (
    <NavIcon className={className}>
      <rect data-move="drop" height="8.5" rx="1.5" width="10" x="7" y="2.5" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </NavIcon>
  )
}

/** A small team: one ahead, two beside each other, opening out. */
export function PeopleIcon({ className }: { className?: string }): ReactElement {
  return (
    <NavIcon className={className}>
      <g data-move="rise">
        <circle cx="12" cy="4.5" r="2" />
        <path d="M8.5 10.5a3.5 3.5 0 0 1 7 0" />
      </g>
      <g data-move="left">
        <circle cx="6" cy="14" r="2" />
        <path d="M2.5 20a3.5 3.5 0 0 1 7 0" />
      </g>
      <g data-move="right">
        <circle cx="18" cy="14" r="2" />
        <path d="M14.5 20a3.5 3.5 0 0 1 7 0" />
      </g>
    </NavIcon>
  )
}

/** A page of blanks whose dashed outline flows. */
export function TemplatesIcon({ className }: { className?: string }): ReactElement {
  return (
    <NavIcon className={className}>
      <rect data-move="flow" height="18" rx="2" width="16" x="4" y="3" />
      <rect data-move="grow" height="4" rx="1" width="9" x="7.5" y="7" />
      <path d="M7.5 15h9M7.5 18h5" />
    </NavIcon>
  )
}

/** The folded page, its corner folding over. */
export function FlowIcon({ className }: { className?: string }): ReactElement {
  return (
    <NavIcon className={className}>
      <path d="M5 3h9l5 5v13H5z" />
      <path d="M14 3v5h5" data-move="fold" />
      <path d="M9 13h6M9 17h4" />
    </NavIcon>
  )
}
