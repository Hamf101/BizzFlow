"use client"

import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * A choice with every option on show, one a line or side by side: native radio buttons under
 * one name, so a form posts the chosen option as a select would.
 *
 * @param props - The group's accessible name, its form name, options, answer and change callback.
 * @returns The radio group.
 */
export function RadioChoices({
  across,
  className,
  id,
  label,
  name,
  onChange,
  options,
  required,
  value,
}: {
  across?: boolean
  className?: string
  id?: string
  label: string
  name: string
  onChange: (value: string) => void
  options: readonly string[]
  required?: boolean
  value: string
}): ReactElement {
  return (
    <div aria-label={label} className={cn("flex gap-2", across ? "flex-wrap gap-x-5" : "flex-col", className)} data-slot="radio-group" id={id} role="radiogroup">
      {/* Nothing chosen still posts an empty answer, as an unchosen select does. */}
      <input name={name} type="hidden" value="" />
      {options.map((option: string) => (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-5" key={option}>
          <input
            checked={value === option}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            name={name}
            onChange={() => onChange(option)}
            required={required}
            type="radio"
            value={option}
          />
          {option}
        </label>
      ))}
    </div>
  )
}

/**
 * A question any number of whose options may be ticked, every option on show:
 * plain checkboxes, with the ticked list posted under one name as JSON.
 *
 * @param props - The group's accessible name, its form name, options, ticked list and change callback.
 * @returns The checkbox group.
 */
export function CheckboxChoices({
  across,
  className,
  id,
  label,
  name,
  onChange,
  options,
  value,
}: {
  across?: boolean
  className?: string
  id?: string
  label: string
  name: string
  onChange: (value: string[]) => void
  options: readonly string[]
  value: readonly string[]
}): ReactElement {
  return (
    <div aria-label={label} className={cn("flex gap-2", across ? "flex-wrap gap-x-5" : "flex-col", className)} data-slot="checkbox-group" id={id} role="group">
      <input name={name} type="hidden" value={JSON.stringify(value)} />
      {options.map((option: string) => (
        <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-5" key={option}>
          <input
            checked={value.includes(option)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            // Ticks keep the options' order, whatever order they were ticked in.
            onChange={(event) => onChange(options.filter((other) => (other === option ? event.target.checked : value.includes(other))))}
            type="checkbox"
            value={option}
          />
          {option}
        </label>
      ))}
    </div>
  )
}
