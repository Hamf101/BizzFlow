"use client"

import {
  Copy,
  ExternalLink,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import {
  useMemo,
  useState,
  type ReactElement,
} from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
  PreviewCardTrigger,
} from "@/components/ui/preview-card"
import { Select } from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatMediumDate } from "@/lib/date-format"
import {
  canAssignOrganizationRole,
  canInviteMembers,
  getOrganizationRoleFromSubject,
  type OrganizationPermissionSubject,
  type OrganizationRole,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type {
  OrganizationInvite,
  OrganizationMember,
  OrganizationRoleDefinition,
} from "@/types/organization"

type ServerFormAction = (formData: FormData) => void | Promise<void>
type PeopleFilter = "all" | string

const MEMBER_PREVIEW_DELAY_MS = 900

type PeopleWorkspaceProps = {
  actorRole: OrganizationPermissionSubject
  createInviteAction: ServerFormAction
  currentTime: string
  invites: OrganizationInvite[]
  members: OrganizationMember[]
  organizationId: string
  roles: OrganizationRoleDefinition[]
  revokeInviteAction: ServerFormAction
  updateMemberAccessAction: ServerFormAction
}

const roleLabels: Record<OrganizationRole, string> = {
  external_reviewer: "External reviewer",
  manager: "Manager",
  owner_admin: "Owner admin",
  staff: "Staff",
}

/**
 * Renders the approved searchable People directory and its progressively disclosed actions.
 *
 * @param props - Organization members, invitations, authorization role, and server actions.
 * @returns The searchable directory, filters, and centered invitation workspace.
 */
export function PeopleWorkspace({
  actorRole,
  createInviteAction,
  currentTime,
  invites,
  members,
  organizationId,
  roles,
  revokeInviteAction,
  updateMemberAccessAction,
}: PeopleWorkspaceProps): ReactElement {
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<PeopleFilter>("all")
  const normalizedQuery = query.trim().toLowerCase()
  const visibleMembers = useMemo(
    () =>
      members.filter((member: OrganizationMember): boolean => {
        const matchesRole =
          roleFilter === "all" || member.roleDefinitionId === roleFilter
        const searchableText = [
          member.workspaceDisplayName,
          member.fullName,
          member.email,
          getMemberRoleName(member),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return matchesRole && searchableText.includes(normalizedQuery)
      }),
    [members, normalizedQuery, roleFilter]
  )

  return (
    <TooltipProvider>
      <section
        className="flex min-h-[calc(100dvh-10rem)] flex-col gap-5"
        data-slot="people-workspace"
      >
        <div className="flex items-baseline gap-2">
          {/* The real space keeps the accessible name "People 3 members"
              rather than "People3 members"; the small margin keeps the gap. */}
          <h1
            className="text-2xl leading-none font-medium tracking-[-0.02em]"
            data-slot="people-heading"
          >
            People{" "}
            <span
              aria-label={`${members.length} members`}
              className="ml-0.5 text-xl font-normal text-muted-foreground"
            >
              {members.length}
            </span>
          </h1>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="relative block min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search people"
              className="h-11 rounded-[12px] bg-card pl-10 md:h-11"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people…"
              type="search"
              value={query}
            />
          </label>
          {canInviteMembers(actorRole) ? (
            <InviteWorkspace
              createInviteAction={createInviteAction}
              currentTime={currentTime}
              invites={invites}
              organizationId={organizationId}
              roles={roles.filter((role) =>
                canAssignOrganizationRole(actorRole, role)
              )}
              revokeInviteAction={revokeInviteAction}
            />
          ) : null}
        </div>

        <RoleFilters
          activeFilter={roleFilter}
          members={members}
          onChange={setRoleFilter}
          roles={roles}
        />

        <MemberDirectory
          actorRole={actorRole}
          members={visibleMembers}
          organizationId={organizationId}
          roles={roles}
          updateMemberAccessAction={updateMemberAccessAction}
        />

        {getOrganizationRoleFromSubject(actorRole) === "owner_admin" ? (
          <Link
            className="mt-auto mb-12 w-fit whitespace-nowrap text-sm font-normal text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 md:mb-0"
            href="/settings#roles-and-access"
          >
            Edit roles and access →
          </Link>
        ) : null}
      </section>
    </TooltipProvider>
  )
}

function RoleFilters({
  activeFilter,
  members,
  onChange,
  roles,
}: {
  activeFilter: PeopleFilter
  members: OrganizationMember[]
  onChange: (filter: PeopleFilter) => void
  roles: OrganizationRoleDefinition[]
}): ReactElement {
  const filters: PeopleFilter[] = ["all", ...roles.map((role) => role.id)]

  return (
    <>
      <div
        aria-label="Filter people by role"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 max-md:hidden"
        data-slot="desktop-role-filters"
        role="group"
      >
        {filters.map((filter: PeopleFilter) => {
          const { count, label } = getRoleFilterDetails(filter, members, roles)

          return (
            <button
              aria-pressed={activeFilter === filter}
              className={cn(
                "min-h-9 shrink-0 rounded-full px-3 text-sm font-normal text-muted-foreground outline-none transition-colors hover:bg-secondary/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
                activeFilter === filter && "bg-secondary text-secondary-foreground"
              )}
              key={filter}
              onClick={() => onChange(filter)}
              type="button"
            >
              {label}
              <span className="ml-1 text-xs text-current/75">{count}</span>
            </button>
          )
        })}
      </div>
      <Select
        aria-label="Filter people by role"
        className="h-10 w-fit min-w-40 rounded-[10px] bg-secondary/55 font-normal md:hidden"
        data-slot="mobile-role-filter"
        onChange={(event) => onChange(event.target.value)}
        value={activeFilter}
      >
        {filters.map((filter: PeopleFilter) => {
          const { count, label } = getRoleFilterDetails(filter, members, roles)
          return (
            <option key={filter} value={filter}>
              {filter === "all" ? "All roles" : label} · {count}
            </option>
          )
        })}
      </Select>
    </>
  )
}

function MemberDirectory({
  actorRole,
  members,
  organizationId,
  roles,
  updateMemberAccessAction,
}: {
  actorRole: OrganizationPermissionSubject
  members: OrganizationMember[]
  organizationId: string
  roles: OrganizationRoleDefinition[]
  updateMemberAccessAction: ServerFormAction
}): ReactElement {
  return (
    <div
      aria-label="Organization members"
      className="flex flex-col gap-1"
      data-slot="people-directory"
      role="table"
    >
      <div
        className="hidden grid-cols-[minmax(16rem,1.5fr)_minmax(9rem,.75fr)_minmax(8rem,.65fr)_3rem] gap-4 px-3 py-2 text-[11px] font-normal tracking-[0.08em] text-muted-foreground uppercase lg:grid"
        role="row"
      >
        <span role="columnheader">Member</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Joined</span>
        <span aria-hidden="true" />
      </div>

      {members.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground" role="status">
          No people match this search.
        </p>
      ) : (
        members.map((member: OrganizationMember) => (
          <MemberRow
            actorRole={actorRole}
            key={member.id}
            member={member}
            organizationId={organizationId}
            roles={roles}
            updateMemberAccessAction={updateMemberAccessAction}
          />
        ))
      )}
    </div>
  )
}

function MemberRow({
  actorRole,
  member,
  organizationId,
  roles,
  updateMemberAccessAction,
}: {
  actorRole: OrganizationPermissionSubject
  member: OrganizationMember
  organizationId: string
  roles: OrganizationRoleDefinition[]
  updateMemberAccessAction: ServerFormAction
}): ReactElement {
  const memberLabel = getMemberDisplayName(member)

  return (
    <div
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-2 rounded-[12px] px-1 py-2 transition-colors hover:bg-card/65 lg:grid-cols-[minmax(16rem,1.5fr)_minmax(9rem,.75fr)_minmax(8rem,.65fr)_3rem] lg:gap-4 lg:px-3 lg:py-3"
      role="row"
    >
      <div className="flex min-w-0 items-center gap-3" role="cell">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground"
        >
          {getInitials(memberLabel)}
        </span>
        <MemberProfilePreview member={member} name={memberLabel} />
      </div>

      <div className="justify-self-end lg:justify-self-start" role="cell">
        <RoleBadge label={getMemberRoleName(member)} />
      </div>

      <span
        className="hidden text-sm text-muted-foreground lg:block"
        role="cell"
      >
        {formatMediumDate(member.createdAt)}
      </span>

      <div className="justify-self-end" role="cell">
        {member.role !== "owner_admin" &&
        getOrganizationRoleFromSubject(actorRole) === "owner_admin" ? (
          <MemberRoleDialog
            member={member}
            organizationId={organizationId}
            roles={roles}
            updateMemberAccessAction={updateMemberAccessAction}
          />
        ) : null}
      </div>
    </div>
  )
}

function MemberProfilePreview({
  member,
  name,
}: {
  member: OrganizationMember
  name: string
}): ReactElement {
  const [previewHandle] = useState(createPreviewCardHandle)
  const triggerId = `member-profile-${member.id}`

  return (
    <PreviewCard handle={previewHandle}>
      <span
        className="min-w-0"
        onClick={() => previewHandle.open(triggerId)}
        onFocus={() => previewHandle.open(triggerId)}
      >
        <PreviewCardTrigger
          closeDelay={300}
          data-hover-delay={MEMBER_PREVIEW_DELAY_MS}
          data-slot="member-profile-trigger"
          delay={MEMBER_PREVIEW_DELAY_MS}
          handle={previewHandle}
          id={triggerId}
          render={
            <button
              className="min-w-0 truncate rounded-[6px] px-0.5 py-1 text-left text-sm font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/35"
              type="button"
            />
          }
        >
          {name}
        </PreviewCardTrigger>
      </span>
      <PreviewCardContent
        aria-label={`Profile for ${name}`}
        data-slot="member-profile-content"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground"
          >
            {getInitials(name)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium tracking-[-0.01em]">
              {name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {getMemberRoleName(member)}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 text-sm">
          <ProfileDetail label="Email" value={member.email} />
          {member.phoneNumber ? (
            <ProfileDetail label="Phone" value={member.phoneNumber} />
          ) : null}
          <ProfileDetail label="Joined" value={formatMediumDate(member.createdAt)} />
        </dl>
      </PreviewCardContent>
    </PreviewCard>
  )
}

function ProfileDetail({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-normal text-muted-foreground">{label}</dt>
      <dd className="truncate font-normal text-foreground">{value}</dd>
    </div>
  )
}

function MemberRoleDialog({
  member,
  organizationId,
  roles,
  updateMemberAccessAction,
}: {
  member: OrganizationMember
  organizationId: string
  roles: OrganizationRoleDefinition[]
  updateMemberAccessAction: ServerFormAction
}): ReactElement {
  const memberLabel = member.fullName ?? member.email

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            aria-label={`Manage ${memberLabel}`}
            className="font-normal"
            size="icon-sm"
            title={`Manage ${memberLabel}`}
            type="button"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent className="sm:aspect-square sm:max-w-md sm:content-start">
        <DialogHeader>
          <DialogTitle className="font-medium">Manage member</DialogTitle>
          <DialogDescription>{memberLabel}</DialogDescription>
        </DialogHeader>
        <form action={updateMemberAccessAction} className="flex flex-col gap-5">
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="membershipId" type="hidden" value={member.id} />
          <Field>
            <FieldLabel htmlFor={`display-name-${member.id}`}>
              Workspace display name
            </FieldLabel>
            <Input
              defaultValue={member.workspaceDisplayName ?? member.fullName ?? ""}
              id={`display-name-${member.id}`}
              maxLength={120}
              name="workspaceDisplayName"
            />
            <FieldDescription>
              This name changes only in this workspace.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`role-${member.id}`}>Access role</FieldLabel>
            <Select
              defaultValue={member.roleDefinitionId ?? ""}
              id={`role-${member.id}`}
              name="roleDefinitionId"
            >
              {roles
                .filter((role) => role.systemKey !== "owner_admin")
                .map((role: OrganizationRoleDefinition) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Button
            className="self-end font-normal"
            type="submit"
          >
            Save member
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteWorkspace({
  createInviteAction,
  currentTime,
  invites,
  organizationId,
  roles,
  revokeInviteAction,
}: {
  createInviteAction: ServerFormAction
  currentTime: string
  invites: OrganizationInvite[]
  organizationId: string
  roles: OrganizationRoleDefinition[]
  revokeInviteAction: ServerFormAction
}): ReactElement {
  const [view, setView] = useState<"compose" | "manage">("compose")
  const now = Date.parse(currentTime)
  const activeInvites = invites.filter(
    (invite: OrganizationInvite) =>
      invite.status === "pending" && Date.parse(invite.expiresAt) > now
  )
  const expiredInvites = invites.filter(
    (invite: OrganizationInvite) =>
      invite.status === "expired" || Date.parse(invite.expiresAt) <= now
  )

  return (
    <Dialog onOpenChange={(open) => !open && setView("compose")}>
      <DialogTrigger
        render={
          <Button className="rounded-[12px] px-4 font-normal" type="button">
            <Plus aria-hidden="true" data-icon="inline-start" />
            <span className="max-sm:sr-only">Invite</span>
          </Button>
        }
      />
      <DialogContent className="aspect-square max-h-[calc(100dvh-2rem)] max-w-xl grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="font-medium">Invite people</DialogTitle>
          <DialogDescription className="sr-only">
            Send a new invitation or manage invitation links.
          </DialogDescription>
        </DialogHeader>

        <div aria-label="Invitation view" className="flex gap-1" role="tablist">
          <InviteTab
            active={view === "compose"}
            onClick={() => setView("compose")}
          >
            New invite
          </InviteTab>
          <InviteTab
            active={view === "manage"}
            onClick={() => setView("manage")}
          >
            Manage invites
            <span className="ml-1 text-xs text-current/75">{activeInvites.length}</span>
          </InviteTab>
        </div>

        {view === "compose" ? (
          <InviteForm
            action={createInviteAction}
            organizationId={organizationId}
            roles={roles}
          />
        ) : (
          <InviteManager
            activeInvites={activeInvites}
            expiredInvites={expiredInvites}
            organizationId={organizationId}
            revokeInviteAction={revokeInviteAction}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function InviteTab({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}): ReactElement {
  return (
    <button
      aria-selected={active}
      className={cn(
        "min-h-10 rounded-full px-3 text-sm font-normal text-muted-foreground outline-none transition-colors hover:bg-secondary/55 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
        active && "bg-secondary text-secondary-foreground"
      )}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  )
}

function InviteForm({
  action,
  organizationId,
  roles,
}: {
  action: ServerFormAction
  organizationId: string
  roles: OrganizationRoleDefinition[]
}): ReactElement {
  const assignableRoles = roles.filter(
    (role) => role.systemKey !== "owner_admin"
  )

  if (assignableRoles.length === 0) {
    return (
      <p className="rounded-[12px] py-8 text-center text-sm text-muted-foreground">
        No role you can invite yet. Ask an owner.
      </p>
    )
  }

  return (
    <form action={action} className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
      <input name="organizationId" type="hidden" value={organizationId} />
      <div aria-label="Invitation method" className="flex gap-1" role="group">
        <Button className="font-normal" size="sm" type="button" variant="secondary">
          Email
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className="font-normal"
                disabled
                size="sm"
                title="SMS invitation delivery is not configured yet."
                type="button"
                variant="ghost"
              >
                Phone
              </Button>
            }
          />
          <TooltipContent>SMS invitation delivery is not configured yet.</TooltipContent>
        </Tooltip>
      </div>

      <FieldGroup className="gap-2">
        <Field>
          <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
          <Input
            autoComplete="email"
            id="invite-email"
            name="email"
            placeholder="name@company.com"
            required
            type="email"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <Select
            defaultValue={
              assignableRoles.find((role) => role.systemKey === "staff")?.id ??
              assignableRoles[0]?.id
            }
            id="invite-role"
            name="roleDefinitionId"
            required
          >
            {assignableRoles.map((role: OrganizationRoleDefinition) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
      </FieldGroup>

      <DialogFooter className="mt-auto flex-row justify-end border-t-0 pt-0">
        <DialogClose render={<Button className="font-normal" variant="ghost" />}>
          Cancel
        </DialogClose>
        <Button className="font-normal" type="submit">
          Send invite
        </Button>
      </DialogFooter>
    </form>
  )
}

function InviteManager({
  activeInvites,
  expiredInvites,
  organizationId,
  revokeInviteAction,
}: {
  activeInvites: OrganizationInvite[]
  expiredInvites: OrganizationInvite[]
  organizationId: string
  revokeInviteAction: ServerFormAction
}): ReactElement {
  return (
    <div className="min-h-0 overflow-y-auto pr-1" role="tabpanel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Active invites</h2>
        <span className="text-xs text-muted-foreground">
          {activeInvites.length} awaiting response
        </span>
      </div>

      {activeInvites.length === 0 ? (
        <p className="rounded-[12px] py-8 text-center text-sm text-muted-foreground">
          No active invites.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {activeInvites.map((invite: OrganizationInvite) => (
            <InviteItem
              invite={invite}
              key={invite.id}
              organizationId={organizationId}
              revokeInviteAction={revokeInviteAction}
              state="active"
            />
          ))}
        </div>
      )}

      {expiredInvites.length > 0 ? (
        <details className="group mt-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-[10px] px-2 text-sm font-normal text-muted-foreground outline-none hover:bg-secondary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35">
            Expired invites
            <span className="ml-1 text-xs text-current/75">{expiredInvites.length}</span>
            <span aria-hidden="true" className="ml-auto transition-transform group-open:rotate-180">
              ↓
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {expiredInvites.map((invite: OrganizationInvite) => (
              <InviteItem
                invite={invite}
                key={invite.id}
                organizationId={organizationId}
                revokeInviteAction={revokeInviteAction}
                state="expired"
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function InviteItem({
  invite,
  organizationId,
  revokeInviteAction,
  state,
}: {
  invite: OrganizationInvite
  organizationId: string
  revokeInviteAction: ServerFormAction
  state: "active" | "expired"
}): ReactElement {
  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-[12px] border bg-card/70 p-3",
        state === "active" ? "border-success/55" : "border-border"
      )}
      data-invite-state={state}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.email}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {invite.roleName ?? roleLabels[invite.role]} · {state === "active" ? "expires" : "expired"}{" "}
          {formatMediumDate(invite.expiresAt)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {state === "active" ? (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    aria-label={`Open invite for ${invite.email}`}
                    className="inline-flex size-11 items-center justify-center rounded-[8px] text-muted-foreground outline-none hover:bg-secondary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/35 md:size-8"
                    href={`/accept-invite/${invite.token}`}
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </Link>
                }
              />
              <TooltipContent>Open invite link</TooltipContent>
            </Tooltip>
            <CopyInviteButton invite={invite} />
          </>
        ) : null}
        <form action={revokeInviteAction}>
          <input name="organizationId" type="hidden" value={organizationId} />
          <input name="inviteId" type="hidden" value={invite.id} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`${state === "expired" ? "Delete expired" : "Delete"} invite for ${invite.email}`}
                  className="font-normal"
                  size="icon-sm"
                  type="submit"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>Delete invite</TooltipContent>
          </Tooltip>
        </form>
      </div>
    </article>
  )
}

function CopyInviteButton({ invite }: { invite: OrganizationInvite }): ReactElement {
  const [copied, setCopied] = useState(false)

  async function copyInvite(): Promise<void> {
    const inviteUrl = new URL(
      `/accept-invite/${invite.token}`,
      window.location.origin
    ).toString()

    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      window.prompt("Copy this invite link:", inviteUrl)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={`Copy invite for ${invite.email}`}
            className="font-normal"
            onClick={copyInvite}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Copy aria-hidden="true" />
          </Button>
        }
      />
      <TooltipContent>{copied ? "Copied" : "Copy invite link"}</TooltipContent>
    </Tooltip>
  )
}

function RoleBadge({ label }: { label: string }): ReactElement {
  return (
    <Badge
      className="font-sans text-[11px] font-normal tracking-normal normal-case"
      variant="secondary"
    >
      {label}
    </Badge>
  )
}

function getMemberRoleName(member: OrganizationMember): string {
  return member.roleName ?? roleLabels[member.role]
}

function getMemberDisplayName(member: OrganizationMember): string {
  const explicitName =
    member.workspaceDisplayName?.trim() || member.fullName?.trim()
  if (explicitName) {
    return explicitName
  }

  const emailName = member.email
    .split("@", 1)[0]
    .split("+", 1)[0]
    .replace(/[._-]+/g, " ")
    .trim()

  return emailName
    ? emailName.replace(/\b[a-z]/g, (character) => character.toLocaleUpperCase())
    : "Member"
}

function getRoleFilterDetails(
  filter: PeopleFilter,
  members: OrganizationMember[],
  roles: OrganizationRoleDefinition[]
): { count: number; label: string } {
  if (filter === "all") {
    return { count: members.length, label: "All" }
  }

  return {
    count: members.filter((member) => member.roleDefinitionId === filter).length,
    label: roles.find((role) => role.id === filter)?.name ?? "Role",
  }
}

function getInitials(value: string): string {
  const parts = value
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?"
}
