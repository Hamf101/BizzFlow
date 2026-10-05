"use client"

import type { ReactElement } from "react"

/**
 * Stands in for an answer the browser cannot check on its own, such as a
 * drawing, a file, ticks or a grid: while it is missing the form is held back
 * and the field is named as required, as any other field is.
 *
 * @param props - Whether the answer is there, and the field's name.
 * @returns An input only the browser's checks see.
 */
export function RequiredStandIn({ filled, label }: { filled: boolean; label: string }): ReactElement {
  return (
    <input
      aria-hidden="true"
      aria-label={label}
      className="sr-only"
      onChange={() => undefined}
      required
      tabIndex={-1}
      value={filled ? "answered" : ""}
    />
  )
}
