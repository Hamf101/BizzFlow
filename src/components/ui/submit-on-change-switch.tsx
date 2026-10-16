"use client"

import { type ComponentProps, type ReactElement, useRef } from "react"

import { Switch } from "@/components/ui/switch"

/**
 * A switch that saves itself: changing it submits its form, so a setting
 * takes effect without a Save button. Pair it with a Save button in
 * `<noscript>` so the form still works without script.
 *
 * @param props - The switch's own properties.
 * @returns The switch.
 */
export function SubmitOnChangeSwitch(props: ComponentProps<typeof Switch>): ReactElement {
  const ref = useRef<HTMLButtonElement>(null)

  return (
    <Switch
      {...props}
      onCheckedChange={(checked, details) => {
        props.onCheckedChange?.(checked, details)
        // After this change has reached the switch's own field.
        setTimeout(() => ref.current?.closest("form")?.requestSubmit())
      }}
      ref={ref}
    />
  )
}
