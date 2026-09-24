"use client"

import Link from "next/link"
import { type ReactElement, useLayoutEffect, useRef, useState } from "react"

import type { ListOption } from "@/components/data/list-option"
import { cn } from "@/lib/utils"

type GliderBox = { height: number; left: number; top: number; width: number }

/**
 * Shows a list's main filter as quiet pills that stay out of the way.
 *
 * Each pill is a plain link to the filtered view, so it works before
 * hydration and the view can be shared. With `glide`, the selected pill's fill
 * slides to the next choice instead of jumping there.
 *
 * @param props - Accessible name for the group, its options, and whether the
 *   selected fill glides.
 * @returns A horizontally scrolling row of filter links.
 */
export function ListFilterChips({
  glide = false,
  label,
  options,
}: {
  glide?: boolean
  label: string
  options: readonly ListOption[]
}): ReactElement {
  const navRef = useRef<HTMLElement>(null)
  const [glider, setGlider] = useState<GliderBox | null>(null)
  const selectedIndex = options.findIndex((option: ListOption) => option.selected)

  // Measured after layout, so until then, and without script, the selected
  // pill paints its own fill.
  useLayoutEffect(() => {
    if (!glide) {
      return
    }

    const pill = navRef.current?.querySelectorAll<HTMLElement>(
      '[data-slot="list-filter-chip"]'
    )[selectedIndex]

    setGlider(
      pill
        ? {
            height: pill.offsetHeight,
            left: pill.offsetLeft,
            top: pill.offsetTop,
            width: pill.offsetWidth,
          }
        : null
    )
  }, [glide, options, selectedIndex])

  return (
    <nav
      aria-label={label}
      className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      data-slot="list-filter-chips"
      ref={navRef}
    >
      {glider ? (
        <span
          aria-hidden="true"
          className="absolute top-0 left-0 rounded-full bg-secondary transition-[translate,width] duration-200 ease-out"
          data-slot="list-filter-glider"
          style={{
            height: glider.height,
            translate: `${glider.left}px ${glider.top}px`,
            width: glider.width,
          }}
        />
      ) : null}
      {options.map((option: ListOption) => (
        <Link
          aria-current={option.selected ? "true" : undefined}
          className={cn(
            "relative inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-normal whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-secondary/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
            option.selected && "text-secondary-foreground",
            option.selected && glider === null && "bg-secondary"
          )}
          data-slot="list-filter-chip"
          href={option.href}
          key={option.label}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}
