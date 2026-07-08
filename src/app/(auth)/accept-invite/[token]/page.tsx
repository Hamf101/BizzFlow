import Link from "next/link"
import type { ReactElement } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  const preview = await getInvitePreview(token).catch((error: unknown) => {
    console.error("invite_preview_load_failed", {
      tokenLength: token.length,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    })
    return null
  })

  if (!preview) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invite unavailable</CardTitle>
          <CardDescription>
            This invite link is invalid, expired, or already accepted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTitle>Unable to load invite</AlertTitle>
            <AlertDescription>Ask the workspace owner for a new invite.</AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Link
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Accept invite</CardTitle>
        <CardDescription>
          Join {preview.organizationName} with the invited email address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          {query.error && (
            <Alert variant="destructive">
              <AlertTitle>Unable to accept invite</AlertTitle>
              <AlertDescription>{query.error}</AlertDescription>
            </Alert>
          )}
          <InviteSummary preview={preview} />
          <form action={acceptInviteAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              Accept invite
            </Button>
          </form>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-sm text-muted-foreground">Need another account?</span>
        <Link
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={`/login?next=/accept-invite/${encodeURIComponent(token)}`}
        >
          Sign in
        </Link>
      </CardFooter>
    </Card>
  )
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
        <span className="font-medium">{formatDate(preview.expiresAt)}</span>
      </div>
    </div>
  )
}

function formatRole(role: OrganizationRole): string {
  return roleLabels[role]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value))
}
