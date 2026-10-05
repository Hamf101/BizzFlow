import Link from "next/link"
import type { ReactElement } from "react"

import { NewPasswordFields } from "@/components/auth/new-password-fields"
import { PasswordInput } from "@/components/auth/password-input"
import { ProfileFields } from "@/components/auth/profile-fields"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { readSignedFlash } from "@/lib/form-utils"
import { AuthPageCard } from "@/lib/page-auth-card"

type FormAction = (formData: FormData) => Promise<void>

export type InviteLinkPageProps = {
  token: string
  /** The link's own page. */
  path: string
  /** The address the link was sent to. */
  email: string
  title: string
  description: string
  /** What the main button says. */
  submitLabel: string
  /** Heading over a failure sent back in `?error=`. */
  problemTitle: string
  /** Shown to someone signed in as another address. */
  wrongAccount: string
  query: { account?: string; error?: string; sig?: string }
  actions: { accept: FormAction; join: FormAction; switchAccount: FormAction }
}

const linkClassName = "text-sm font-medium text-primary underline-offset-4 hover:underline"

/**
 * The card a link that no longer works shows, with a way to log in.
 *
 * @param props - What went wrong and what to do about it.
 * @returns The failure card.
 */
export function InviteLinkGone({ description, title }: { description: string; title: string }): ReactElement {
  return (
    <AuthPageCard
      description={description}
      footer={
        <Link className={linkClassName} href="/login">
          Log in
        </Link>
      }
      title={title}
    />
  )
}

/**
 * One page answers an emailed link: someone new chooses a password, someone
 * with an account enters theirs, and someone signed in accepts with one press.
 *
 * @param props - The link, its copy, and the route's actions.
 * @returns The card for whoever is (or isn't) signed in.
 */
export async function InviteLinkPage({
  actions,
  description,
  email,
  path,
  problemTitle,
  query,
  submitLabel,
  title,
  token,
  wrongAccount,
}: InviteLinkPageProps): Promise<ReactElement> {
  const user = await loadInviteUser()
  const flashError = readSignedFlash(query).error
  const problem = flashError ? (
    <Alert variant="destructive">
      <AlertTitle>{problemTitle}</AlertTitle>
      <AlertDescription>{flashError}</AlertDescription>
    </Alert>
  ) : null
  const tokenField = <input type="hidden" name="token" value={token} />

  if (user && user.email?.toLowerCase() !== email) {
    return (
      <AuthPageCard
        description={wrongAccount}
        footer={<span className="text-sm text-muted-foreground">Logged in as {user.email ?? "another account"}</span>}
        title={title}
      >
        <form action={actions.switchAccount}>
          {tokenField}
          <Button type="submit" className="w-full">
            Log out and continue
          </Button>
        </form>
      </AuthPageCard>
    )
  }

  if (user) {
    return (
      <AuthPageCard
        description={description}
        footer={<span className="text-sm text-muted-foreground">Logged in as {email}</span>}
        title={title}
      >
        <form action={actions.accept} className="flex flex-col gap-5">
          {tokenField}
          {problem}
          <Button type="submit" className="w-full">
            {submitLabel}
          </Button>
        </form>
      </AuthPageCard>
    )
  }

  const existing = query.account === "existing"
  return (
    <AuthPageCard
      description={description}
      footer={
        existing ? (
          <>
            <span className="text-sm text-muted-foreground">New to BizFlow?</span>
            <Link className={linkClassName} href={path}>
              Choose a password instead
            </Link>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">Already use BizFlow?</span>
            <Link className={linkClassName} href={`${path}?account=existing`}>
              Log in instead
            </Link>
          </>
        )
      }
      footerClassName="justify-between gap-3"
      title={title}
    >
      <form action={actions.join} className="flex flex-col gap-5">
        {tokenField}
        <input type="hidden" name="account" value={existing ? "existing" : "new"} />
        {problem}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="username" value={email} readOnly />
          </Field>
          {existing ? (
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Link
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  href="/forgot-password"
                >
                  Forgot password?
                </Link>
              </div>
              <PasswordInput id="password" name="password" autoComplete="current-password" required minLength={8} />
            </Field>
          ) : (
            <>
              <ProfileFields />
              <NewPasswordFields label="Choose a password" />
            </>
          )}
        </FieldGroup>
        <Button type="submit" className="w-full">
          {submitLabel}
        </Button>
      </form>
    </AuthPageCard>
  )
}

async function loadInviteUser(): Promise<{ email: string | null } | null> {
  try {
    const user = await getAuthenticatedUser()
    return { email: user.email }
  } catch (error: unknown) {
    if (error instanceof AuthenticationError) {
      return null
    }

    console.error("invite_user_load_failed", {
      reason: error instanceof Error ? error.message : "Unknown authentication error",
    })
    return null
  }
}
