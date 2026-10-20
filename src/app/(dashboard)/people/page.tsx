import { redirect } from "next/navigation"
import type { ReactElement, ReactNode } from "react"

import Link from "next/link"

import { changeStructureAction } from "@/app/(dashboard)/settings/actions"
import { OrgChart } from "@/components/people/org-chart"
import { PeopleWorkspace } from "@/components/people/people-workspace"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SetupIncomplete } from "@/components/ui/page-state"
import { buildFeedbackRedirect } from "@/lib/action-result"
import type { RawSearchParams } from "@/lib/list-state"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import { cn } from "@/lib/utils"
import { getOrganizationStructure, listOrganizationPeople } from "@/services/organization-service"

import {
  createInviteAction,
  revokeInviteAction,
  updateMemberAccessAction,
} from "./actions"
import type { Metadata } from "next"

/**
 * Lists the organization's people, narrowed by any words search sent along.
 *
 * @param props - The words, as `q`.
 * @returns The People workspace, or a user-safe load failure.
 */
export const metadata: Metadata = { title: "People" }

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}): Promise<ReactElement> {
  const { q, view } = await searchParams
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
          <SetupIncomplete message={contextErrorMessage} />
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

  // Only an owner arranges teams, so only they get the chart.
  const isOwner = context.membership.role === "owner_admin"
  const showTeams = isOwner && view === "teams"
  const structure = showTeams
    ? await getOrganizationStructure({ actorUserId: user.id, organizationId: context.organization.id }).catch((error: unknown) => {
        console.warn("people_structure_load_failed", { organizationId: context.organization.id, reason: error instanceof Error ? error.message : "Unknown error" })
        return null
      })
    : null

  return (
    <PeopleShell>
      {isOwner ? <PeopleViews teams={showTeams} /> : null}
      {showTeams ? (
        structure ? (
          <OrgChart change={changeStructureAction} members={people.members} structure={structure} workspaceName={context.organization.name} />
        ) : (
          <Alert variant="destructive">
            <AlertTitle>Teams unavailable</AlertTitle>
            <AlertDescription>Reload the page to try again.</AlertDescription>
          </Alert>
        )
      ) : (
      <PeopleWorkspace
        actorRole={context.membership}
        createInviteAction={createInviteAction}
        currentTime={new Date().toISOString()}
        invites={people.invites}
        members={people.members}
        organizationId={context.organization.id}
        query={(Array.isArray(q) ? q[0] : q)?.trim().slice(0, 100)}
        roles={people.roles}
        revokeInviteAction={revokeInviteAction}
        updateMemberAccessAction={updateMemberAccessAction}
      />
      )}
    </PeopleShell>
  )
}

function PeopleViews({ teams }: { teams: boolean }): ReactElement {
  const tab = (active: boolean): string =>
    cn(
      "inline-flex h-9 items-center rounded-full px-4 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
      active ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
    )

  return (
    <nav aria-label="People views" className="inline-flex w-fit rounded-full bg-muted p-1">
      <Link aria-current={teams ? undefined : "page"} className={tab(!teams)} href="/people">
        List
      </Link>
      <Link aria-current={teams ? "page" : undefined} className={tab(teams)} href="/people?view=teams">
        Teams
      </Link>
    </nav>
  )
}

function PeopleShell({
  children,
}: {
  children: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">{children}</div>
  )
}
