import type { ReactElement } from "react"

import { InviteLinkGone, InviteLinkPage } from "@/components/auth/invite-link-page"
import { buildSharedDocumentPath } from "@/lib/auth-redirects"
import { DocumentServiceError, getGuestInvite } from "@/services/document-service"

import {
  acceptSharedDocumentAction,
  openSharedDocumentWithPasswordAction,
  switchSharedDocumentAccountAction,
} from "./actions"

type SharedDocumentParams = Promise<{
  token: string
}>

type SharedDocumentSearchParams = Promise<{
  account?: string
  error?: string
  sig?: string
}>

/**
 * Where someone outside a workspace opens the one document emailed to them.
 * They never become a member: the link gives them this document alone.
 */
export default async function SharedDocumentPage({
  params,
  searchParams,
}: {
  params: SharedDocumentParams
  searchParams: SharedDocumentSearchParams
}): Promise<ReactElement> {
  const { token } = await params
  // The service logs why a link failed; a 404 or 410 says why in words they can act on.
  const invite = await getGuestInvite(token).catch((error: unknown) => ({
    failure:
      error instanceof DocumentServiceError && error.statusCode < 500
        ? error.message
        : "Ask the person who shared it to send a new one.",
  }))

  if ("failure" in invite) {
    return <InviteLinkGone description={invite.failure} title="This link no longer works" />
  }

  return (
    <InviteLinkPage
      actions={{
        accept: acceptSharedDocumentAction,
        join: openSharedDocumentWithPasswordAction,
        switchAccount: switchSharedDocumentAccountAction,
      }}
      description="Only this document is shared with you."
      email={invite.email}
      path={buildSharedDocumentPath(token)}
      problemTitle="Unable to open it yet"
      query={await searchParams}
      submitLabel="Open the document"
      title={`${invite.organizationName} shared “${invite.documentTitle}” with you`}
      token={token}
      wrongAccount={`This link is for ${invite.email}. Log out to open it with that address.`}
    />
  )
}
