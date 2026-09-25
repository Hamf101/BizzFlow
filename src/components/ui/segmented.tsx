"use client"

import type { KeyboardEvent, ReactElement, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A short row of choices, one of them chosen: a radio group drawn as joined
 * segments. The arrow keys move the choice and only the chosen segment takes a
 * Tab stop.
 *
 * @param props - The group's name, its choices, the chosen value and a change callback.
 * @returns The segmented radio group.
 */
export function Segmented<Value extends string>({
  className,
  label,
  onChange,
  options,
  value,
}: {
  className?: string
  label: string
  onChange: (value: Value) => void
  options: readonly Readonly<{ label: ReactNode; value: Value }>[]
  value: Value
}): ReactElement {
  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    const index = options.findIndex((option) => option.value === value)
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0

    if (step === 0) {
      return
    }

    event.preventDefault()
    const group = event.currentTarget
    const next = options[(index + step + options.length) % options.length]

    if (next) {
      onChange(next.value)
      requestAnimationFrame(() => group.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus())
    }
  }

  return (
    <div
      aria-label={label}
      className={cn("inline-flex rounded-[11px] border border-border bg-card/70 p-0.5", className)}
      onKeyDown={handleKey}
      role="radiogroup"
    >
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className={cn(
            "h-8 rounded-[9px] px-3 text-[13px] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
            option.value === value && "bg-card text-foreground shadow-sm"
          )}
          data-value={option.value}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          tabIndex={option.value === value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
