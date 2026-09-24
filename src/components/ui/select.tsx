import type { ComponentProps, ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Native select styled to match the themed input control.
 *
 * A native `<select>` rather than a popup: these sit inside progressive
 * enhancement server-action forms, and the platform control is the one that
 * still works before hydration and gives mobile its own picker.
 *
 * Height is mobile-first — 44px below `md`, the designed 32px above — matching
 * the pattern in `input.tsx`.
 *
 * @param props - Standard select attributes.
 * @returns A themed native select.
 */
export function Select({
  className,
  ...props
}: ComponentProps<"select">): ReactElement {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-[8px] border border-input bg-card px-2.5 py-1 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:h-8 md:text-sm",
        className
      )}
      data-slot="select"
      {...props}
    />
  )
}
