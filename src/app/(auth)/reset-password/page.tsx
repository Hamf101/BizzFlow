import Link from "next/link"

import { NewPasswordFields } from "@/components/auth/new-password-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button, buttonVariants } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { getAuthenticatedUser } from "@/lib/auth"
import { AuthPageCard } from "@/lib/page-auth-card"
import { cn } from "@/lib/utils"

import { resetPasswordAction } from "./actions"

type ResetPasswordSearchParams = Promise<{
  error?: string
  token_hash?: string
}>

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: ResetPasswordSearchParams
}) {
  const params = await searchParams
  // The emailed link brings its token; someone already signed in needs none.
  const canReset =
    Boolean(params.token_hash) || (await getAuthenticatedUser().then(() => true, () => false))

  const backToLogIn = (
    <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/login">
      Back to log in
    </Link>
  )

  if (!canReset) {
    return (
      <AuthPageCard
        description="It has expired or was already used. Ask for a new one."
        footer={backToLogIn}
        title="This link no longer works"
      >
        <Link className={cn(buttonVariants(), "w-full")} href="/forgot-password">
          Email me a new link
        </Link>
      </AuthPageCard>
    )
  }

  return (
    <AuthPageCard footer={backToLogIn} title="Choose a new password">
      <form action={resetPasswordAction} className="flex flex-col gap-5">
        {params.token_hash && <input name="token_hash" type="hidden" value={params.token_hash} />}
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Password not saved</AlertTitle>
            <AlertDescription>{params.error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <NewPasswordFields confirmLabel="Confirm new password" label="New password" />
        </FieldGroup>
        <Button className="w-full" type="submit">
          Save password
        </Button>
      </form>
    </AuthPageCard>
  )
}
