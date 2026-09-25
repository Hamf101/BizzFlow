"use client"

import { Check } from "lucide-react"
import { type ReactElement, useEffect, useRef, useState } from "react"

import { PasswordInput } from "@/components/auth/password-input"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { PASSWORD_RULES } from "@/types/password"

type NewPasswordFieldsProps = {
  confirmLabel?: string
  label?: string
}

/**
 * A new password typed twice. Its rules tick off as they're met, a note shows
 * while the two differ, and the browser holds the form until both are right;
 * the server checks the same rules again.
 *
 * @param props - The two fields' labels.
 * @returns The fields, named `password` and `confirm`, for a form's field group.
 */
export function NewPasswordFields({
  confirmLabel = "Confirm password",
  label = "Password",
}: NewPasswordFieldsProps): ReactElement {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const fields = useRef<HTMLDivElement>(null)
  const strong = PASSWORD_RULES.every((rule) => rule.met(password))
  const differ = confirm !== "" && confirm !== password

  useEffect(() => {
    fields.current
      ?.querySelector<HTMLInputElement>('input[name="password"]')
      ?.setCustomValidity(strong ? "" : "Meet every rule listed under the password.")
    fields.current
      ?.querySelector<HTMLInputElement>('input[name="confirm"]')
      ?.setCustomValidity(differ ? "The passwords don't match." : "")
  }, [differ, strong])

  return (
    // No box of its own, so the two fields space out like the rest of the group.
    <div className="contents" ref={fields}>
      <Field>
        <FieldLabel htmlFor="password">{label}</FieldLabel>
        <PasswordInput
          aria-describedby="password-rules"
          autoComplete="new-password"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          value={password}
        />
        <ul className="grid gap-1 text-sm text-muted-foreground" id="password-rules">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.met(password)

            return (
              <li className={cn("flex items-center gap-2", met && "text-foreground")} key={rule.hint}>
                <Check aria-hidden="true" className={cn("size-3.5", !met && "opacity-30")} />
                {rule.hint}
                {met && <span className="sr-only">, done</span>}
              </li>
            )
          })}
        </ul>
      </Field>
      <Field>
        <FieldLabel htmlFor="confirm">{confirmLabel}</FieldLabel>
        <PasswordInput
          aria-invalid={differ || undefined}
          autoComplete="new-password"
          id="confirm"
          name="confirm"
          onChange={(event) => setConfirm(event.target.value)}
          required
          value={confirm}
        />
        {differ && <FieldError>The passwords don&apos;t match.</FieldError>}
      </Field>
    </div>
  )
}
