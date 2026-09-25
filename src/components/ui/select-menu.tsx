"use client"

import { Select as BaseSelect } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import type { ChangeEvent, ReactElement } from "react"

import { type Choice, FIELD_BUTTON_CLASS_NAME, readChoices, type SelectProps } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/**
 * The select once someone reaches for it: Base UI's select in the app's own
 * colours, which `Select` loads on demand.
 *
 * @param props - The select's props, and whether it opens as it mounts.
 * @returns The working select.
 */
export default function SelectMenu({
  children,
  className,
  "data-slot": slot = "select",
  defaultOpen,
  defaultValue,
  disabled,
  id,
  name,
  onChange,
  required,
  value,
  ...aria
}: SelectProps & { defaultOpen?: boolean }): ReactElement {
  const choices = readChoices(children)
  const labels = Object.fromEntries(choices.map((choice) => [choice.value, choice.label]))
  // Like a native select, one left to itself starts on its first choice.
  const initial = defaultValue ?? (value === undefined ? choices.find((choice) => !choice.disabled)?.value : undefined)

  return (
    <BaseSelect.Root
      defaultOpen={defaultOpen}
      defaultValue={initial === undefined ? undefined : String(initial)}
      disabled={disabled}
      items={labels}
      name={name}
      onValueChange={(next: unknown) => {
        const selected = typeof next === "string" ? next : ""
        onChange?.({ currentTarget: { name, value: selected }, target: { name, value: selected } } as ChangeEvent<HTMLSelectElement>)
      }}
      required={required}
      value={value === undefined ? undefined : String(value)}
    >
      <BaseSelect.Trigger
        {...aria}
        className={cn(FIELD_BUTTON_CLASS_NAME, className)}
        data-slot={slot}
        // On the button itself, so a `<label htmlFor>` names what people press.
        id={id}
      >
        <BaseSelect.Value className="min-w-0 truncate data-placeholder:text-muted-foreground" />
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown aria-hidden="true" className="size-4" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner alignItemWithTrigger={false} className="z-[60] outline-none" sideOffset={4}>
          <BaseSelect.Popup className="max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto rounded-[12px] border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[scale,opacity] duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0">
            <BaseSelect.List>
              {choices.map((choice: Choice) => (
                <BaseSelect.Item
                  className="grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-[8px] py-2 pr-3 pl-2 text-sm outline-none select-none data-disabled:text-muted-foreground data-highlighted:bg-muted md:py-1.5"
                  disabled={choice.disabled}
                  key={choice.value}
                  value={choice.value}
                >
                  <BaseSelect.ItemIndicator className="col-start-1 text-primary">
                    <Check aria-hidden="true" className="size-3.5" />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="col-start-2 truncate">{choice.label}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}
