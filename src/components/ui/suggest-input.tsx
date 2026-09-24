"use client"

import { Autocomplete } from "@base-ui/react/autocomplete"
import type { ReactElement } from "react"

import { Input } from "@/components/ui/input"

/**
 * A text field that offers earlier answers as someone types, in the app's own
 * menu rather than the platform's suggestion list. Anything may still be
 * typed; a suggestion only saves the typing.
 *
 * @param props - The field's value or starting value, its change callback,
 *   the suggestions, and the input's id, name, length limit and placeholder.
 * @returns The text field with its suggestions.
 */
export function SuggestInput({
  defaultValue,
  id,
  maxLength,
  name,
  onChange,
  placeholder,
  suggestions,
  value,
}: {
  defaultValue?: string
  id?: string
  maxLength?: number
  name?: string
  onChange?: (value: string) => void
  placeholder?: string
  suggestions: readonly string[]
  value?: string
}): ReactElement {
  return (
    <Autocomplete.Root
      defaultValue={defaultValue}
      items={suggestions}
      name={name}
      onValueChange={(next: string) => onChange?.(next)}
      openOnInputClick
      value={value}
    >
      <Autocomplete.Input render={<Input id={id} maxLength={maxLength} placeholder={placeholder} />} />
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="z-[60] outline-none" sideOffset={4}>
          <Autocomplete.Popup className="max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-[12px] border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 data-empty:hidden data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Autocomplete.List>
              {(suggestion: string) => (
                <Autocomplete.Item
                  className="cursor-default rounded-[8px] px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-muted md:py-1.5"
                  key={suggestion}
                  value={suggestion}
                >
                  {suggestion}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
