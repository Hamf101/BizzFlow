"use client"

import { type ComponentProps, type ReactElement, useLayoutEffect, useRef } from "react"

/**
 * Keeps the newest column and the chosen file's preview in view when Columns
 * is wider than the screen, as Finder does, instead of opening at the first.
 *
 * @param props - The columns' container attributes and the columns.
 * @returns A horizontally scrolling container that follows its far end.
 */
export function ColumnsScroller(props: ComponentProps<"div">): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  // Each move along the path renders new columns, and follows them.
  useLayoutEffect(() => {
    ref.current?.scrollTo({ left: ref.current.scrollWidth })
  })

  return <div ref={ref} {...props} />
}
