"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import type { ReactElement } from "react"

import { cn } from "@/lib/utils"

/**
 * Renders a compact visual switch inside a physical 44px interaction cell.
 *
 * @param props - Base UI switch properties and the visual track size.
 * @returns An accessible switch with visible focus and disabled states.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}): ReactElement {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex h-11 w-14 min-w-11 shrink-0 items-center rounded-[8px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:ring-2 aria-invalid:ring-destructive/25 data-disabled:cursor-not-allowed data-disabled:opacity-50 motion-reduce:transition-none",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full bg-input transition-colors group-data-checked/switch:bg-primary group-data-[size=default]/switch:left-3 group-data-[size=default]/switch:h-[18.4px] group-data-[size=default]/switch:w-8 group-data-[size=sm]/switch:left-4 group-data-[size=sm]/switch:h-[14px] group-data-[size=sm]/switch:w-6 motion-reduce:transition-none dark:bg-input/80"
        data-slot="switch-track"
      />
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:left-3 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:left-4 group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[14px] group-data-[size=sm]/switch:data-checked:translate-x-[10px] group-data-[size=default]/switch:data-unchecked:translate-x-0 group-data-[size=sm]/switch:data-unchecked:translate-x-0 motion-reduce:transition-none dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
