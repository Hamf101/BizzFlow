import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PeopleWorkspace } from "@/components/people/people-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { buildFeedbackRedirect } from "@/lib/action-result"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { listOrganizationPeople } from "@/services/organization-service"

import {
  createInviteAction,
  revokeInviteAction,
  updateMemberAccessAction,
} from "./actions"

export default async function PeoplePage(): Promise<ReactElement> {
  const user = await loadAuthenticatedPageUser("/people")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "people_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <PeopleShell>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </PeopleShell>
      )
    }

    redirect(
      buildFeedbackRedirect("/dashboard", "organization_required")
    )
  }

  const { people, errorMessage: peopleErrorMessage } = await listOrganizationPeople(
    user.id,
    context.organization.id
  )
    .then((people) => ({ people, errorMessage: null as string | null }))
    .catch((error: unknown) => {
      const errorMessage = getPageErrorMessage(error, "Unable to load people.")

      console.warn("people_load_failed", {
        userId: user.id,
        organizationId: context.organization.id,
        reason: errorMessage,
      })

      return {
        people: null,
        errorMessage,
      }
    })

  if (!people) {
    return (
      <PeopleShell>
        <Alert variant="destructive">
          <AlertTitle>People unavailable</AlertTitle>
          <AlertDescription>{peopleErrorMessage}</AlertDescription>
        </Alert>
      </PeopleShell>
    )
  }

  return (
    <PeopleShell>
      <PeopleWorkspace
        actorRole={context.membership}
        createInviteAction={createInviteAction}
        currentTime={new Date().toISOString()}
        invites={people.invites}
        members={people.members}
        organizationId={context.organization.id}
        roles={people.roles}
        revokeInviteAction={revokeInviteAction}
        updateMemberAccessAction={updateMemberAccessAction}
      />
    </PeopleShell>
  )
}

function PeopleShell({
  children,
}: {
  children: ReactElement | ReactElement[]
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">{children}</div>
  )
}
