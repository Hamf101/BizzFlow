import Link from "next/link"
import type { ReactElement } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { AuthPageCard } from "@/lib/page-auth-card"
import { cn } from "@/lib/utils"

import { confirmEmailAction } from "./actions"

type ConfirmEmailSearchParams = Promise<{
  error?: string
  token_hash?: string
  type?: string
}>

const linkClassName = "text-sm font-medium text-primary underline-offset-4 hover:underline"

/**
 * Where the confirmation email lands. It confirms only when pressed, so a mail
 * scanner that opens the link first can't use it up.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: ConfirmEmailSearchParams
}): Promise<ReactElement> {
  const params = await searchParams

  if (!params.token_hash || params.error) {
    return (
      <AuthPageCard
        description="It has expired or was already used. Sign up again for a new one, or log in if you've confirmed already."
        footer={
          <Link className={linkClassName} href="/login">
            Log in
          </Link>
        }
        title="This link no longer works"
      >
        <Link className={cn(buttonVariants(), "w-full")} href="/signup">
          Sign up again
        </Link>
      </AuthPageCard>
    )
  }

  return (
    <AuthPageCard
      description="One step left: confirm this is your address, then name your workspace."
      footer={
        <>
          <span className="text-sm text-muted-foreground">Already confirmed?</span>
          <Link className={linkClassName} href="/login">
            Log in
          </Link>
        </>
      }
      footerClassName="justify-between gap-3"
      title="Confirm your email"
    >
      <form action={confirmEmailAction}>
        <input name="token_hash" type="hidden" value={params.token_hash} />
        <input name="type" type="hidden" value={params.type ?? "signup"} />
        <Button className="w-full" type="submit">
          Confirm my email
        </Button>
      </form>
    </AuthPageCard>
  )
}
