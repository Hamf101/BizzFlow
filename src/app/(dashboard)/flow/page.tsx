import type { Metadata } from "next"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { FlowTab } from "@/components/flow/flow-launcher"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"

export const metadata: Metadata = { title: "Flow" }

/**
 * The Flow tab: a whole page for talking to Flow about the workspace. What
 * Flow may find is decided per request by the services it calls.
 *
 * @returns The conversation, or a load failure.
 */
export default async function FlowPage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/flow")
  const { context, errorMessage } = await loadPageOrganizationContext({ userId: user.id, failureEvent: "flow_context_load_failed" })

  if (!context) {
    if (!errorMessage) redirect(buildFeedbackRedirect("/dashboard", "organization_required"))

    return (
      <Alert className="m-4 w-auto" variant="destructive">
        <AlertTitle>Flow unavailable</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <h1 className="sr-only">Flow</h1>
      <FlowTab organizationId={context.organization.id} />
    </>
  )
}
