import type { ComponentProps, ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Textarea styled to match the themed input control.
 *
 * No mobile height bump: a textarea is already well past 44px, and its
 * `min-h` is set per use so a comment box and a description field can differ.
 *
 * @param props - Standard textarea attributes.
 * @returns A themed textarea.
 */
export function Textarea({
  className,
  ...props
}: ComponentProps<"textarea">): ReactElement {
  return (
    <textarea
      className={cn(
        "min-h-20 w-full resize-y rounded-[8px] border border-input bg-card px-2.5 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  )
}
