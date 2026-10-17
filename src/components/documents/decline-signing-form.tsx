"use client"

import { type ReactElement, useActionState } from "react"

import { declinePublicSigningAction } from "@/app/sign/[token]/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Lets a signer turn the document down with a reason, tucked behind a
 * disclosure so it never competes with signing.
 *
 * @param props - The signer's private token.
 * @returns The decline control, or its confirmation once sent.
 */
export function DeclineSigningForm({ token }: { token: string }): ReactElement {
  const [state, decline, pending] = useActionState(declinePublicSigningAction, null)

  if (state && "declinedFor" in state) {
    return (
      <Alert>
        <AlertTitle>You declined to sign</AlertTitle>
        <AlertDescription>We told {state.declinedFor} why. This link no longer works.</AlertDescription>
      </Alert>
    )
  }

  return (
    <details className="group text-sm">
      <summary className="w-fit cursor-pointer text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Decline to sign
      </summary>
      <form action={decline} className="mt-3 flex flex-col gap-3">
        <input name="token" type="hidden" value={token} />
        <label className="flex flex-col gap-1.5" htmlFor="decline-reason">
          <span className="font-medium">Why are you not signing?</span>
          <span className="text-muted-foreground">The sender sees this, and the document goes back to them to change.</span>
        </label>
        <Textarea id="decline-reason" maxLength={500} name="reason" required rows={3} />
        {state && "error" in state ? <p className="text-destructive" role="alert">{state.error}</p> : null}
        <Button className="w-fit" disabled={pending} type="submit" variant="destructive">
          {pending ? "Declining…" : "Decline"}
        </Button>
      </form>
    </details>
  )
}
