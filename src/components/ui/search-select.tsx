"use client"

import { Combobox } from "@base-ui/react/combobox"
import { Check } from "lucide-react"
import { type ReactElement, useMemo } from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** One choice: what the form sends, what it reads as, and a quieter line under it. */
export type SearchOption = Readonly<{ hint?: string; label: string; value: string }>

/**
 * A dropdown you can type into: the list narrows to what matches as you type,
 * by name or by its quieter line (an email, a role). It sends its value with
 * the form it sits in, as a select does, so it drops in where one was.
 *
 * @param props - The options, the empty choice's words if there is one, and the usual field props.
 * @returns The field.
 */
export function SearchSelect({
  className,
  defaultValue,
  disabled,
  emptyLabel,
  id,
  label,
  name,
  onValueChange,
  options,
  placeholder = "Search",
  value,
}: {
  className?: string
  defaultValue?: string
  disabled?: boolean
  /** A choice of none, such as "Unassigned"; left out, something must be chosen. */
  emptyLabel?: string
  id?: string
  /** Its name to assistive tech, when no label is tied to it by id. */
  label?: string
  name?: string
  onValueChange?: (value: string) => void
  options: readonly SearchOption[]
  /** What to type, such as "Search people". */
  placeholder?: string
  value?: string
}): ReactElement {
  const byValue = useMemo(
    () => new Map<string, SearchOption>([...(emptyLabel === undefined ? [] : [["", { label: emptyLabel, value: "" }] as const]), ...options.map((option) => [option.value, option] as const)]),
    [emptyLabel, options]
  )
  const items = useMemo(() => [...byValue.keys()], [byValue])

  return (
    <Combobox.Root
      defaultValue={defaultValue}
      disabled={disabled}
      // The words of a choice and its quieter line both match what is typed.
      filter={(item: string, query: string) => {
        const option = byValue.get(item)
        const words = query.trim().toLowerCase()
        return !words || `${option?.label ?? ""} ${option?.hint ?? ""}`.toLowerCase().includes(words)
      }}
      items={items}
      itemToStringLabel={(item: string) => byValue.get(item)?.label ?? ""}
      name={name}
      onValueChange={(next: string | null) => onValueChange?.(next ?? "")}
      value={value}
    >
      <Combobox.Input render={<Input aria-label={label} autoComplete="off" className={className} id={id} placeholder={placeholder} />} />
      <Combobox.Portal>
        <Combobox.Positioner className="z-[60] outline-none" sideOffset={4}>
          <Combobox.Popup className="max-h-[min(18rem,var(--available-height))] w-[var(--anchor-width)] min-w-56 origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <Combobox.Empty className="px-2.5 py-2 text-sm text-muted-foreground empty:hidden">Nothing matches that.</Combobox.Empty>
            <Combobox.List>
              {(item: string) => {
                const option = byValue.get(item)!

                return (
                  <Combobox.Item
                    className={cn(
                      "grid cursor-default grid-cols-[1rem_1fr] items-center gap-x-2 rounded-md px-2 py-2 text-sm outline-none select-none data-highlighted:bg-muted md:py-1.5",
                      !option.value && "text-muted-foreground"
                    )}
                    key={item || "none"}
                    value={item}
                  >
                    <Combobox.ItemIndicator className="col-start-1">
                      <Check aria-hidden="true" className="size-3.5" />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 truncate">{option.label}</span>
                    {option.hint ? <span className="col-start-2 truncate text-xs text-muted-foreground">{option.hint}</span> : null}
                  </Combobox.Item>
                )
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
