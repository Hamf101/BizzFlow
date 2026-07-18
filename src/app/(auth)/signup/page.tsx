import Link from "next/link"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { AuthPageCard } from "@/lib/page-auth-card"
import { getInvitePreview } from "@/services/organization-service"
import type { InvitePreview } from "@/types/organization"

import { signupAction } from "./actions"

type SignupSearchParams = Promise<{
  error?: string
  invite?: string
}>

export default async function SignupPage({
  searchParams,
}: {
  searchParams: SignupSearchParams
}) {
  const params = await searchParams
  const invite = await loadInvite(params.invite)

  if (params.invite && !invite) {
    return (
      <AuthPageCard
        description="This invite link is invalid, expired, or already accepted."
        footer={
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        }
        title="Invite unavailable"
      />
    )
  }

  const invitePath = params.invite ? buildAcceptInvitePath(params.invite) : null

  return (
    <AuthPageCard
      description={
        invite
          ? `Create an account for ${invite.email} to join ${invite.organizationName}.`
          : "Start an organization workspace for document collection and review."
      }
      footer={
        <>
          <span className="text-sm text-muted-foreground">
            Already have an account?
          </span>
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={
              invitePath
                ? `/login?next=${encodeURIComponent(invitePath)}`
                : "/login"
            }
          >
            Sign in
          </Link>
        </>
      }
      footerClassName="justify-between gap-3"
      title={invite ? "Create your account" : "Create your BizFlow account"}
    >
      <form action={signupAction} className="flex flex-col gap-5">
        {params.invite && (
          <input type="hidden" name="inviteToken" value={params.invite} />
        )}
        {params.error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to create account</AlertTitle>
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
              defaultValue={invite?.email ?? ""}
              readOnly={Boolean(invite)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <FieldDescription>
              {invite
                ? "Use at least 8 characters. Confirm your email, then accept the workspace invite."
                : "Use at least 8 characters. Organization setup comes next."}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </AuthPageCard>
  )
}

async function loadInvite(token: string | undefined): Promise<InvitePreview | null> {
  if (!token) {
    return null
  }

  try {
    return await getInvitePreview(token)
  } catch (error: unknown) {
    console.warn("signup_invite_preview_load_failed", {
      tokenLength: token.length,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    })
    return null
  }
}
