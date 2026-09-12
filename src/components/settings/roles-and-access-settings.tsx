"use client"

import { ChevronRight, Plus, ShieldCheck, Trash2 } from "lucide-react"
import type { ReactElement, ReactNode } from "react"

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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  getOrganizationRolePermissions,
  ORGANIZATION_PERMISSION_ACTIONS,
  type OrganizationPermissionAction,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"
import type {
  OrganizationMember,
  OrganizationRoleDefinition,
} from "@/types/organization"

type ServerFormAction = (formData: FormData) => void | Promise<void>

type RolesAndAccessSettingsProps = {
  archiveRoleAction: ServerFormAction
  createRoleAction: ServerFormAction
  members: OrganizationMember[]
  organizationId: string
  roles: OrganizationRoleDefinition[]
  updateRoleAction: ServerFormAction
}

type PermissionGroupDefinition = {
  label: string
  permissions: readonly OrganizationPermissionAction[]
}

const permissionLabels: Record<OrganizationPermissionAction, string> = {
  "people:view": "View people",
  "organization:manage": "Manage workspace notifications",
  "members:invite": "Invite people",
  "members:update_role": "Update member access",
  "audit_logs:view": "View audit log",
  "audit_logs:verify": "Verify audit chain",
  "templates:view": "View templates",
  "templates:manage": "Manage templates",
  "documents:view": "View documents",
  "documents:send": "Send documents",
  "documents:fill": "Fill documents",
  "document_comments:create": "Comment on documents",
  "documents:create": "Create documents",
  "documents:archive": "Archive documents",
  "folders:manage": "Manage folders",
  "document_versions:create": "Upload document versions",
  "submissions:view": "View submissions",
  "submissions:create": "Create submissions",
  "submissions:edit": "Edit submissions",
  "submissions:assign": "Assign submissions",
  "submissions:review": "Review submissions",
  "submission_comments:create": "Comment on submissions",
  "tasks:view": "View tasks",
  "tasks:create": "Create tasks",
  "tasks:edit": "Edit tasks",
  "tasks:assign": "Assign tasks",
}

const permissionGroups: readonly PermissionGroupDefinition[] = [
  {
    label: "People & workspace",
    // "members:update_role" is not offered: member names and roles are
    // Owner-only in the service and database, so granting it would do nothing.
    permissions: ["people:view", "organization:manage", "members:invite"],
  },
  {
    label: "Documents & templates",
    permissions: [
      "templates:view",
      "templates:manage",
      "documents:view",
      "documents:send",
      "documents:fill",
      "document_comments:create",
      "documents:create",
      "documents:archive",
      "folders:manage",
      "document_versions:create",
    ],
  },
  {
    label: "Submissions",
    permissions: [
      "submissions:view",
      "submissions:create",
      "submissions:edit",
      "submissions:assign",
      "submissions:review",
      "submission_comments:create",
    ],
  },
  {
    label: "Tasks",
    permissions: ["tasks:view", "tasks:create", "tasks:edit", "tasks:assign"],
  },
  {
    label: "Audit",
    permissions: ["audit_logs:view", "audit_logs:verify"],
  },
]

/**
 * Renders owner-only role configuration as quiet rows with on-demand editors.
 *
 * @param props - Tenant roles, usage counts, and thin server actions.
 * @returns The Settings role library and centered role editors.
 */
export function RolesAndAccessSettings({
  archiveRoleAction,
  createRoleAction,
  members,
  organizationId,
  roles,
  updateRoleAction,
}: RolesAndAccessSettingsProps): ReactElement {
  const orderedRoles = [...roles].sort(
    (left, right) =>
      getRolePriority(left) - getRolePriority(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.name.localeCompare(right.name)
  )

  return (
    <section
      className="scroll-mt-24"
      data-slot="roles-and-access-settings"
      id="roles-and-access"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-xl font-medium tracking-[-0.015em]">
              Roles and access
            </h2>
            <span className="text-lg font-normal text-muted-foreground">
              {roles.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Set role names and permissions for this workspace.
          </p>
        </div>
        <NewRoleDialog
          action={createRoleAction}
          organizationId={organizationId}
        />
      </div>

      <div className="mt-5 flex flex-col gap-1" role="list">
        {orderedRoles.map((role: OrganizationRoleDefinition) => (
          <RoleEditorDialog
            action={updateRoleAction}
            archiveAction={archiveRoleAction}
            key={role.id}
            memberCount={members.filter(
              (member) => member.roleDefinitionId === role.id
            ).length}
            organizationId={organizationId}
            role={role}
          />
        ))}
      </div>
    </section>
  )
}

function RoleEditorDialog({
  action,
  archiveAction,
  memberCount,
  organizationId,
  role,
}: {
  action: ServerFormAction
  archiveAction: ServerFormAction
  memberCount: number
  organizationId: string
  role: OrganizationRoleDefinition
}): ReactElement {
  const isOwner = role.systemKey === "owner_admin"
  const permissions = isOwner
    ? ORGANIZATION_PERMISSION_ACTIONS
    : role.permissions ??
      (role.systemKey ? getOrganizationRolePermissions(role.systemKey) : [])
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[12px] px-3 text-left font-normal hover:bg-secondary/45"
            type="button"
            variant="ghost"
          />
        }
      >
        <span className="min-w-0 truncate text-sm font-medium">{role.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isOwner ? <ShieldCheck aria-hidden="true" /> : null}
          {formatPeopleCount(memberCount)}
        </span>
        <ChevronRight aria-hidden="true" className="text-muted-foreground" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:aspect-square sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-medium">Edit role</DialogTitle>
          <DialogDescription>
            {isOwner
              ? "Owner keeps full access. Only its visible name can change."
              : "Change this role's name, access, or availability."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <form action={action} className="flex flex-col gap-5">
            <input name="organizationId" type="hidden" value={organizationId} />
            <input name="roleId" type="hidden" value={role.id} />
            {isOwner ? (
              <input name="permissionsLocked" type="hidden" value="true" />
            ) : null}
            <Field>
              <FieldLabel htmlFor={`role-name-${role.id}`}>Role name</FieldLabel>
              <Input
                defaultValue={role.name}
                id={`role-name-${role.id}`}
                maxLength={60}
                minLength={2}
                name="name"
                required
              />
            </Field>

            <PermissionGroups
              disabled={isOwner}
              selectedPermissions={permissions}
            />

            <DialogFooter className="border-t-0 pt-0">
              <DialogClose render={<Button className="font-normal" variant="ghost" />}>
                Cancel
              </DialogClose>
              <Button className="font-normal" type="submit">
                Save role
              </Button>
            </DialogFooter>
          </form>

          {!isOwner ? (
            <form action={archiveAction} className="mt-2">
              <input name="organizationId" type="hidden" value={organizationId} />
              <input name="roleId" type="hidden" value={role.id} />
              <Button
                aria-label={`Remove ${role.name} role`}
                className="font-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
                type="submit"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                Remove role
              </Button>
            </form>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewRoleDialog({
  action,
  organizationId,
}: {
  action: ServerFormAction
  organizationId: string
}): ReactElement {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button className="font-normal" type="button" variant="ghost">
            <Plus aria-hidden="true" data-icon="inline-start" />
            New role
          </Button>
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:aspect-square sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-medium">Create role</DialogTitle>
          <DialogDescription>
            New roles start with no access. Add only what this role needs.
          </DialogDescription>
        </DialogHeader>
        <form
          action={action}
          className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1"
        >
          <input name="organizationId" type="hidden" value={organizationId} />
          <Field>
            <FieldLabel htmlFor="new-role-name">Role name</FieldLabel>
            <Input
              id="new-role-name"
              maxLength={60}
              minLength={2}
              name="name"
              placeholder="Billing assistant"
              required
            />
          </Field>
          <PermissionGroups disabled={false} selectedPermissions={[]} />
          <DialogFooter className="mt-auto border-t-0 pt-0">
            <DialogClose render={<Button className="font-normal" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button className="font-normal" type="submit">
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PermissionGroups({
  disabled,
  selectedPermissions,
}: {
  disabled: boolean
  selectedPermissions: readonly OrganizationPermissionAction[]
}): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      {permissionGroups.map((group: PermissionGroupDefinition, index: number) => {
        const selectedCount = group.permissions.filter((permission) =>
          selectedPermissions.includes(permission)
        ).length

        return (
          <details
            className="rounded-[12px] bg-secondary/35 open:bg-secondary/45"
            key={group.label}
            open={index === 0}
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-[12px] px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/35">
              <span>{group.label}</span>
              <span className="text-xs text-muted-foreground">
                {selectedCount} of {group.permissions.length}
              </span>
            </summary>
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {group.permissions.map(
                (permission: OrganizationPermissionAction): ReactNode => (
                  <label
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-3 rounded-[9px] px-2 text-sm font-normal",
                      !disabled && "cursor-pointer hover:bg-card/65"
                    )}
                    key={permission}
                  >
                    <span>{permissionLabels[permission]}</span>
                    <Switch
                      defaultChecked={selectedPermissions.includes(permission)}
                      disabled={disabled}
                      name="permissions"
                      size="sm"
                      value={permission}
                    />
                  </label>
                )
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function formatPeopleCount(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`
}

function getRolePriority(role: OrganizationRoleDefinition): number {
  switch (role.systemKey) {
    case "owner_admin":
      return 0
    case "manager":
      return 1
    case "staff":
      return 2
    case "external_reviewer":
      return 3
    default:
      return 4
  }
}
