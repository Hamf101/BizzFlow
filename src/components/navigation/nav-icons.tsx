import type { ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

/*
 * Flow's tab icon, drawn on Lucide's grid and stroke so it sits beside the
 * other tabs' icons; its motion lives in globals.css, under "Nav icons".
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
