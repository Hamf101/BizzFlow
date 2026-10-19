"use client"

import type { ComponentProps, ReactElement, ReactNode } from "react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"

/**
 * A form's submit button that says it is working and takes no second press
 * until its form's action has finished, so a slow sign-up sends one email,
 * not one per impatient tap.
 *
 * @param props - The button's own properties, and the words shown while it works.
 * @returns The submit button.
 */
export function SubmitButton({
  children,
  pendingText,
  ...props
}: Omit<ComponentProps<typeof Button>, "type"> & { children: ReactNode; pendingText: string }): ReactElement {
  const { pending } = useFormStatus()

  return (
    <Button {...props} aria-busy={pending} disabled={pending || props.disabled} type="submit">
      {pending ? pendingText : children}
    </Button>
  )
}
