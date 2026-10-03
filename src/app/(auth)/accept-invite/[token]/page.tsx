import type { ReactElement } from "react"

import { InviteLinkGone, InviteLinkPage } from "@/components/auth/invite-link-page"
import { buildAcceptInvitePath } from "@/lib/auth-redirects"
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
  const preview = await getInvitePreview(token).catch((error: unknown) => {
    console.error("invite_preview_load_failed", {
      tokenLength: token.length,
      reason: error instanceof Error ? error.message : "Unknown invite error",
    })
    return null
  })

  if (!preview) {
    return (
      <InviteLinkGone
        description="It may have expired, been used already, or been withdrawn. Ask the person who invited you to send a new one."
        title="This invite no longer works"
      />
    )
  }

  const title = `Join ${preview.organizationName}`
  return (
    <InviteLinkPage
      actions={{ accept: acceptInviteAction, join: joinWithPasswordAction, switchAccount: switchInviteAccountAction }}
      description={`You're invited to join as ${preview.roleName ?? roleLabels[preview.role]}.`}
      email={preview.email}
      path={buildAcceptInvitePath(token)}
      problemTitle="Unable to join yet"
      query={await searchParams}
      submitLabel={title}
      title={title}
      token={token}
      wrongAccount={`This invite is for ${preview.email}. Log out to join with that address.`}
    />
  )
}
