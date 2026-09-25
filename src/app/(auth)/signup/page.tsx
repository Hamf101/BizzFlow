import Link from "next/link"
import { redirect } from "next/navigation"

import { NewPasswordFields } from "@/components/auth/new-password-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { AuthPageCard } from "@/lib/page-auth-card"

import { signupAction } from "./actions"

type SignupSearchParams = Promise<{
  error?: string
  invite?: string
  sent?: string
}>

export default async function SignupPage({
  searchParams,
}: {
  searchParams: SignupSearchParams
}) {
  const params = await searchParams

  // Invites are answered on their own page now; older links still land there.
  if (params.invite) {
    redirect(buildAcceptInvitePath(params.invite))
  }

  if (params.sent) {
    return (
      <AuthPageCard
        description="We sent you a link to confirm your email address. Open it on this device or any other to finish signing up."
        footer={
          <>
            <span className="text-sm text-muted-foreground">Wrong address?</span>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href="/signup"
            >
              Sign up again
            </Link>
          </>
        }
        footerClassName="justify-between gap-3"
        title="Check your email"
      />
    )
  }

  return (
    <AuthPageCard
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            Already have an account?
          </span>
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            Log in
          </Link>
        </>
      }
      footerClassName="justify-between gap-3"
      title="Sign up for BizFlow"
    >
      <form action={signupAction} className="flex flex-col gap-5">
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to sign up</AlertTitle>
            <AlertDescription>{params.error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </Field>
          <NewPasswordFields />
        </FieldGroup>
        <Button type="submit" className="w-full">
          Sign up
        </Button>
      </form>
    </AuthPageCard>
  )
}
