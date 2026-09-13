import Link from "next/link"
import type { ReactElement } from "react"

import type { ListOption } from "@/components/data/list-option"
import { cn } from "@/lib/utils"

/**
 * Shows a list's main filter as quiet pills that stay out of the way.
 *
 * Each pill is a plain link to the filtered view, so it works before
 * hydration and the view can be shared.
 *
 * @param props - Accessible name for the group and its options.
 * @returns A horizontally scrolling row of filter links.
 */
export function ListFilterChips({
  label,
  options,
}: {
  label: string
  options: readonly ListOption[]
}): ReactElement {
  return (
    <nav
      aria-label={label}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      data-slot="list-filter-chips"
    >
      {options.map((option: ListOption) => (
        <Link
          aria-current={option.selected ? "true" : undefined}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-normal whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-secondary/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
            option.selected && "bg-secondary text-secondary-foreground"
          )}
          href={option.href}
          key={option.label}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}
