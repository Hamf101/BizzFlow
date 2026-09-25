import Link from "next/link"
import type { ReactElement } from "react"

import { NewPasswordFields } from "@/components/auth/new-password-fields"
import { PasswordInput } from "@/components/auth/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { AuthPageCard } from "@/lib/page-auth-card"
import type { OrganizationRole } from "@/lib/permissions"
import { getInvitePreview } from "@/services/organization-service"

import {
  acceptInviteAction,
  joinWithPasswordAction,
  switchInviteAccountAction,
} from "./actions"

type AcceptInviteParams = Promise<{
  token: string
}>

type AcceptInviteSearchParams = Promise<{
  account?: string
  error?: string
}>

const roleLabels: Record<OrganizationRole, string> = {
  owner_admin: "Owner admin",
  manager: "Manager",
  staff: "Staff",
  external_reviewer: "External reviewer",
}

const linkClassName = "text-sm font-medium text-primary underline-offset-4 hover:underline"

/**
 * One page answers an invite: someone new chooses a password, someone with an
 * account enters theirs, and someone signed in joins with one press.
 */
export default async function AcceptInvitePage({
  params,
  searchParams,
}: {
  params: AcceptInviteParams
  searchParams: AcceptInviteSearchParams
}): Promise<ReactElement> {
  const { token } = await params
  const query = await searchParams
  const invitePath = buildAcceptInvitePath(token)
  const preview = await getInvitePreview(token).catch((error: unknown) => {
    console.error("invite_preview_load_failed", {
      tokenLength: token.length,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    })
    return null
  })

  if (!preview) {
    return (
      <AuthPageCard
        description="It may have expired, been used already, or been withdrawn. Ask the person who invited you to send a new one."
        footer={
          <Link className={linkClassName} href="/login">
            Log in
          </Link>
        }
        title="This invite no longer works"
      />
    )
  }

  const user = await loadInviteUser()
  const title = `Join ${preview.organizationName}`
  const role = preview.roleName ?? roleLabels[preview.role]
  const problem = query.error ? (
    <Alert variant="destructive">
      <AlertTitle>Unable to join yet</AlertTitle>
      <AlertDescription>{query.error}</AlertDescription>
    </Alert>
  ) : null
  const tokenField = <input type="hidden" name="token" value={token} />

  if (user && user.email?.toLowerCase() !== preview.email) {
    return (
      <AuthPageCard
        description={`This invite is for ${preview.email}. Log out to join with that address.`}
        footer={<span className="text-sm text-muted-foreground">Logged in as {user.email ?? "another account"}</span>}
        title={title}
      >
        <form action={switchInviteAccountAction}>
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
        description={`You're invited to join as ${role}.`}
        footer={<span className="text-sm text-muted-foreground">Logged in as {preview.email}</span>}
        title={title}
      >
        <form action={acceptInviteAction} className="flex flex-col gap-5">
          {tokenField}
          {problem}
          <Button type="submit" className="w-full">
            {title}
          </Button>
        </form>
      </AuthPageCard>
    )
  }

  const existing = query.account === "existing"
  return (
    <AuthPageCard
      description={`You're invited to join as ${role}.`}
      footer={
        existing ? (
          <>
            <span className="text-sm text-muted-foreground">New to BizFlow?</span>
            <Link className={linkClassName} href={invitePath}>
              Choose a password instead
            </Link>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">Already use BizFlow?</span>
            <Link className={linkClassName} href={`${invitePath}?account=existing`}>
              Log in instead
            </Link>
          </>
        )
      }
      footerClassName="justify-between gap-3"
      title={title}
    >
      <form action={joinWithPasswordAction} className="flex flex-col gap-5">
        {tokenField}
        <input type="hidden" name="account" value={existing ? "existing" : "new"} />
        {problem}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" type="email" autoComplete="username" value={preview.email} readOnly />
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
            <NewPasswordFields label="Choose a password" />
          )}
        </FieldGroup>
        <Button type="submit" className="w-full">
          {title}
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
