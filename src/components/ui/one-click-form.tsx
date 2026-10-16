"use client"

import type { ReactElement, ReactNode } from "react"
import { useFormStatus } from "react-dom"

/**
 * One button that runs a server action the way a word processor's New does:
 * a click makes the thing and opens it, with no form to fill first.
 *
 * @param props - The action, the fields it takes, how the button looks, and what it shows.
 * @returns A form whose single button runs the action.
 */
export function OneClickForm({
  action,
  children,
  className,
  fields = {},
}: {
  action: (formData: FormData) => Promise<void>
  children: ReactNode
  className?: string
  /** Hidden fields sent with it; null sends an empty value. */
  fields?: Readonly<Record<string, string | null>>
}): ReactElement {
  return (
    <form action={action} className="contents">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value ?? ""} />
      ))}
      <Submit className={className}>{children}</Submit>
    </form>
  )
}

function Submit({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  const { pending } = useFormStatus()

  // Disabled while it works, so a double click makes one, not two.
  return (
    <button aria-busy={pending} className={className} disabled={pending} type="submit">
      {children}
    </button>
  )
}
