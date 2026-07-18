import Link from "next/link"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AuthenticationError, getAuthenticatedUser } from "@/lib/auth"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
import { formatMediumDate } from "@/lib/date-format"
import { AuthPageCard } from "@/lib/page-auth-card"
import type { OrganizationRole } from "@/lib/permissions"
import { getInvitePreview } from "@/services/organization-service"
import type { InvitePreview } from "@/types/organization"

import { acceptInviteAction } from "./actions"

type AcceptInviteParams = Promise<{
  token: string
}>

type AcceptInviteSearchParams = Promise<{
  error?: string
}>

const roleLabels: Record<OrganizationRole, string> = {
  owner_admin: "Owner admin",
  manager: "Manager",
  staff: "Staff",
  external_reviewer: "External reviewer",
}

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
      >
        <Alert variant="destructive">
          <AlertTitle>Unable to load invite</AlertTitle>
          <AlertDescription>
            Ask the workspace owner for a new invite.
          </AlertDescription>
        </Alert>
      </AuthPageCard>
    )
  }

  const user = await loadInviteUser()

  return (
    <AuthPageCard
      description={`Join ${preview.organizationName} with the invited email address.`}
      footer={
        user ? (
          <span className="text-sm text-muted-foreground">
            Signed in as {user.email ?? "the current account"}
          </span>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              Already have an account?
            </span>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={`/login?next=${encodeURIComponent(invitePath)}`}
            >
              Sign in
            </Link>
          </>
        )
      }
      footerClassName="justify-between gap-3"
      title="Accept invite"
    >
      <div className="flex flex-col gap-5">
        {query.error && (
          <Alert variant="destructive">
            <AlertTitle>Unable to accept invite</AlertTitle>
            <AlertDescription>{query.error}</AlertDescription>
          </Alert>
        )}
        <InviteSummary preview={preview} />
        {user ? (
          <form action={acceptInviteAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Accept invite
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Create an account or sign in with the invited email address to join.
            </p>
            <Link href={`/signup?invite=${encodeURIComponent(token)}`}>
              <Button className="w-full">Create account</Button>
            </Link>
          </div>
        )}
      </div>
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

function InviteSummary({ preview }: { preview: InvitePreview }): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-background p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Organization</span>
        <span className="font-medium">{preview.organizationName}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Email</span>
        <span className="font-medium">{preview.email}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Role</span>
        <Badge variant="secondary">{formatRole(preview.role)}</Badge>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Expires</span>
        <span className="font-medium">
          {formatMediumDate(preview.expiresAt)}
        </span>
      </div>
    </div>
  )
}

function formatRole(role: OrganizationRole): string {
  return roleLabels[role]
}
