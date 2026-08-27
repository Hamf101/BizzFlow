import Link from "next/link"
import { redirect } from "next/navigation"
import type { ReactElement } from "react"

import { PermissionButton } from "@/components/auth/permission-button"
import { InviteLinkButton } from "@/components/auth/invite-link-button"
import { RoleGuard } from "@/components/auth/role-guard"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { formatMediumDate } from "@/lib/date-format"
import { buildRedirect } from "@/lib/form-utils"
import { loadAuthenticatedPageUser } from "@/lib/page-auth"
import { getPageErrorMessage } from "@/lib/page-errors"
import { loadPageOrganizationContext } from "@/lib/page-organization-context"
import {
  getAssignableOrganizationRoles,
  type OrganizationRole,
} from "@/lib/permissions"
import {
  listOrganizationPeople,
} from "@/services/organization-service"
import type {
  OrganizationContext,
  OrganizationInvite,
  OrganizationMember,
} from "@/types/organization"

import { createInviteAction, updateMemberRoleAction, updateProfilePhoneAction } from "./actions"

type PeopleSearchParams = Promise<{
  error?: string
  message?: string
}>

const roleLabels: Record<OrganizationRole, string> = {
  owner_admin: "Owner admin",
  manager: "Manager",
  staff: "Staff",
  external_reviewer: "External reviewer",
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: PeopleSearchParams
}): Promise<ReactElement> {
  const params = await searchParams
  const user = await loadAuthenticatedPageUser("/people")
  const { context, errorMessage: contextErrorMessage } =
    await loadPageOrganizationContext({
      userId: user.id,
      failureEvent: "people_context_load_failed",
    })

  if (!context) {
    if (contextErrorMessage) {
      return (
        <PeopleShell params={params}>
          <Alert variant="destructive">
            <AlertTitle>Supabase setup incomplete</AlertTitle>
            <AlertDescription>{contextErrorMessage}</AlertDescription>
          </Alert>
        </PeopleShell>
      )
    }

    redirect(
      buildRedirect("/dashboard", {
        error: "Create an organization before managing people.",
      })
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
      <PeopleShell params={params}>
        <Alert variant="destructive">
          <AlertTitle>People unavailable</AlertTitle>
          <AlertDescription>{peopleErrorMessage}</AlertDescription>
        </Alert>
      </PeopleShell>
    )
  }

  return (
    <PeopleShell params={params}>
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-normal">People</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Manage members and pending invites for {context.organization.name}.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <MembersCard
          context={context}
          members={people.members}
        />
        <div className="flex flex-col gap-4">
          <ProfilePhoneCard />
          <RoleGuard role={context.membership.role} action="members:invite">
            <InviteCard organizationId={context.organization.id} />
          </RoleGuard>
          <PendingInvitesCard invites={people.pendingInvites} />
        </div>
      </div>
    </PeopleShell>
  )
}

function PeopleShell({
  children,
  params,
}: {
  children: ReactElement | ReactElement[]
  params: Awaited<PeopleSearchParams>
}): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      {params.error && (
        <Alert variant="destructive">
          <AlertTitle>People action failed</AlertTitle>
          <AlertDescription>{params.error}</AlertDescription>
        </Alert>
      )}

      {params.message && (
        <Alert>
          <AlertTitle>People updated</AlertTitle>
          <AlertDescription>{params.message}</AlertDescription>
        </Alert>
      )}

      {children}
    </div>
  )
}

function MembersCard({
  context,
  members,
}: {
  context: OrganizationContext
  members: OrganizationMember[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Active members in this organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {members.map((member: OrganizationMember) => (
            <div
              className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[minmax(0,1fr)_220px]"
              key={member.id}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{member.email}</span>
                <span className="text-xs text-muted-foreground">
                  Joined {formatMediumDate(member.createdAt)}
                </span>
              </div>
              {member.role !== "owner_admin" ? (
                <RoleGuard
                  action="members:update_role"
                  fallback={<RoleBadge role={member.role} />}
                  role={context.membership.role}
                >
                  <form action={updateMemberRoleAction} className="flex items-end gap-2">
                    <input
                      type="hidden"
                      name="organizationId"
                      value={context.organization.id}
                    />
                    <input type="hidden" name="membershipId" value={member.id} />
                    <Field className="min-w-0">
                      <FieldLabel className="sr-only" htmlFor={`role-${member.id}`}>
                        Role
                      </FieldLabel>
                      <Select
                        defaultValue={member.role}
                        id={`role-${member.id}`}
                        name="role"
                      >
                        {getAssignableOrganizationRoles().map((role: OrganizationRole) => (
                          <option key={role} value={role}>
                            {formatRole(role)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <PermissionButton
                      action="members:update_role"
                      role={context.membership.role}
                      size="sm"
                      type="submit"
                      variant="outline"
                    >
                      Save
                    </PermissionButton>
                  </form>
                </RoleGuard>
              ) : (
                <RoleBadge role={member.role} />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function RoleBadge({ role }: { role: OrganizationRole }): ReactElement {
  return (
    <div className="flex items-center justify-start md:justify-end">
      <Badge variant="secondary">{formatRole(role)}</Badge>
    </div>
  )
}

function InviteCard({ organizationId }: { organizationId: string }): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite staff</CardTitle>
        <CardDescription>
          Email an invite that lets a recipient create an account or sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={createInviteAction} className="flex flex-col gap-5">
          <input type="hidden" name="organizationId" value={organizationId} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input
                autoComplete="email"
                id="invite-email"
                name="email"
                required
                type="email"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select
                defaultValue="staff"
                id="invite-role"
                name="role"
              >
                {getAssignableOrganizationRoles().map((role: OrganizationRole) => (
                  <option key={role} value={role}>
                    {formatRole(role)}
                  </option>
                ))}
              </Select>
              <FieldDescription>
                Owner admin is reserved for initial workspace ownership.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Button type="submit">Send invite</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PendingInvitesCard({
  invites,
}: {
  invites: OrganizationInvite[]
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invites</CardTitle>
        <CardDescription>
          Sent email links remain valid until expiration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {invites.map((invite: OrganizationInvite) => (
              <div className="flex flex-col gap-2 rounded-lg border bg-background p-3" key={invite.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{invite.email}</span>
                  <Badge variant="outline">{formatRole(invite.role)}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  Expires {formatMediumDate(invite.expiresAt)}
                </span>
                <Link
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  href={`/accept-invite/${invite.token}`}
                >
                  Open invite link
                </Link>
                <InviteLinkButton path={`/accept-invite/${invite.token}`} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatRole(role: OrganizationRole): string {
  return roleLabels[role]
}

function ProfilePhoneCard(): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS Phone Number</CardTitle>
        <CardDescription>
          Set your E.164 phone number to receive task reminders & signing alerts via SMS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={updateProfilePhoneAction} className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="profile-phone">Phone Number</FieldLabel>
            <Input
              id="profile-phone"
              name="phoneNumber"
              placeholder="+14155552671"
              type="tel"
            />
            <FieldDescription>
              Include country code (e.g. +14155552671 or +2348012345678).
            </FieldDescription>
          </Field>
          <Button type="submit" variant="outline">
            Save phone number
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
