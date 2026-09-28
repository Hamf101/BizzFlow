import type { ReactElement } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Someone setting up their account says who they are: their name, and a phone
 * number if they like. The server reads both with the profile schema.
 *
 * @returns The fields, named `displayName` and `phoneNumber`, for a form's field group.
 */
export function ProfileFields(): ReactElement {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="displayName">Your name</FieldLabel>
        <Input autoComplete="name" id="displayName" maxLength={200} name="displayName" required type="text" />
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-3">
          <FieldLabel htmlFor="phoneNumber">Phone</FieldLabel>
          <span className="text-sm text-muted-foreground">Optional</span>
        </div>
        <Input autoComplete="tel" id="phoneNumber" name="phoneNumber" placeholder="+1 415 555 2671" type="tel" />
      </Field>
    </>
  )
}
