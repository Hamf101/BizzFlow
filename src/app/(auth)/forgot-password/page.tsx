import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthPageCard } from "@/lib/page-auth-card"

import { requestPasswordResetAction } from "./actions"

type ForgotPasswordSearchParams = Promise<{
  error?: string
  sent?: string
}>

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: ForgotPasswordSearchParams
}) {
  const params = await searchParams
  const backToLogIn = (
    <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/login">
      Back to log in
    </Link>
  )

  if (params.sent) {
    return (
      <AuthPageCard
        description="If an account uses that address, a link to choose a new password is on its way. It works once."
        footer={backToLogIn}
        title="Check your email"
      />
    )
  }

  return (
    <AuthPageCard
      description="We'll email you a link to choose a new one."
      footer={backToLogIn}
      title="Forgot your password?"
    >
      <form action={requestPasswordResetAction} className="flex flex-col gap-5">
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to send a link</AlertTitle>
            <AlertDescription>{params.error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input autoComplete="email" id="email" name="email" required type="email" />
          </Field>
        </FieldGroup>
        <Button className="w-full" type="submit">
          Email me a link
        </Button>
      </form>
    </AuthPageCard>
  )
}
