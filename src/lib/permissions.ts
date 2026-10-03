export const ORGANIZATION_ROLES = [
  "owner_admin",
  "manager",
  "staff",
  "external_reviewer",
] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

/** Each built-in role's name, for a member whose role definition names none. */
export const ORGANIZATION_ROLE_LABELS: Readonly<Record<OrganizationRole, string>> = {
  external_reviewer: "External reviewer",
  manager: "Manager",
  owner_admin: "Owner admin",
  staff: "Staff",
}

export const ORGANIZATION_PERMISSION_ACTIONS = [
  "people:view",
  // Organization-wide notification switches. Owner receives this by default;
  // other roles require an explicit grant because it affects every member.
  "organization:manage",
  "members:invite",
  "members:update_role",
  "audit_logs:view",
  // Chain verification is an incident-response signal for the tenant owner;
  // owner_admin receives it through the full-array grant below.
  "audit_logs:verify",
  "templates:view",
  "templates:create",
  "templates:manage",
  "documents:view",
  "documents:send",
  "documents:fill",
  "document_comments:create",
  "documents:create",
  "documents:archive",
  "folders:manage",
  "document_versions:create",
  "submissions:view",
  "submissions:create",
  "submissions:edit",
  "submissions:assign",
  "submissions:review",
  "submission_comments:create",
  "tasks:view",
  "tasks:create",
  "tasks:edit",
  "tasks:assign",
] as const

export type OrganizationPermissionAction =
  (typeof ORGANIZATION_PERMISSION_ACTIONS)[number]

export type OrganizationPermissionSubject =
  | OrganizationRole
  | {
      role: OrganizationRole
      customPermissions?: readonly OrganizationPermissionAction[] | null
    }

const assignableOrganizationRoles: readonly OrganizationRole[] = [
  "manager",
  "staff",
  "external_reviewer",
]

const permissionsByRole: Record<
  OrganizationRole,
  readonly OrganizationPermissionAction[]
> = {
  owner_admin: ORGANIZATION_PERMISSION_ACTIONS,
  manager: [
    "people:view",
    "members:invite",
    "audit_logs:view",
    "templates:view",
    "templates:create",
    "templates:manage",
    "documents:view",
    "documents:send",
    "documents:fill",
    "document_comments:create",
    "documents:create",
    "documents:archive",
    "folders:manage",
    "document_versions:create",
    "submissions:view",
    "submissions:create",
    "submissions:edit",
    "submissions:assign",
    "submissions:review",
    "submission_comments:create",
    "tasks:view",
    "tasks:create",
    "tasks:edit",
    "tasks:assign",
  ],
  staff: [
    "people:view",
    "templates:view",
    "templates:create",
    "documents:view",
    "documents:send",
    "documents:fill",
    "document_comments:create",
    "documents:create",
    "document_versions:create",
    "submissions:view",
    "submissions:create",
    "submissions:edit",
    "submission_comments:create",
    "tasks:view",
    "tasks:create",
    "tasks:edit",
  ],
  external_reviewer: [
    "people:view",
    "documents:view",
    "document_comments:create",
    "submissions:view",
    "submission_comments:create",
  ],
}

/**
 * Checks whether a value is a supported organization role.
 *
 * @param value - Unknown role value from forms, URLs, or database results.
 * @returns True when the value is one of the supported MVP roles.
 */
export function isOrganizationRole(value: string): value is OrganizationRole {
  return ORGANIZATION_ROLES.includes(value as OrganizationRole)
}

/**
 * Checks whether a stored permission string is an action this build knows.
 *
 * @param value - Permission string read from a role definition.
 * @returns True when the value is a supported permission action.
 */
export function isOrganizationPermissionAction(
  value: string
): value is OrganizationPermissionAction {
  return ORGANIZATION_PERMISSION_ACTIONS.includes(value as OrganizationPermissionAction)
}

/**
 * Parses a persisted base role and optional editable permission set.
 *
 * An unknown role fails closed. An unknown permission action is dropped: a
 * migration can add one before the code that knows it is deployed, and
 * rejecting the whole role then locked every member on it out of the app.
 * Dropping can only narrow access, never widen it.
 *
 * @param role - Legacy base role stored for row-scope compatibility.
 * @param permissions - Role-definition permissions, or null for protected Owner.
 * @returns A permission subject, or null when the role is unsupported.
 */
export function createOrganizationPermissionSubject(
  role: string,
  permissions: readonly string[] | null | undefined
): OrganizationPermissionSubject | null {
  if (!isOrganizationRole(role)) {
    return null
  }

  if (permissions === null || permissions === undefined) {
    return role
  }

  return {
    role,
    customPermissions: permissions.filter(isOrganizationPermissionAction),
  }
}

/**
 * Returns the organization actions allowed for a role.
 *
 * @param role - Current member role.
 * @returns Permission actions granted to the role.
 */
export function getOrganizationRolePermissions(
  role: OrganizationRole
): readonly OrganizationPermissionAction[] {
  return permissionsByRole[role]
}

/**
 * Checks whether a role subject can perform an organization action.
 *
 * @param subject - Current member role and optional custom permissions.
 * @param action - Organization permission action to check.
 * @returns True when the action is allowed for the subject.
 */
export function canPerformOrganizationAction(
  subject: OrganizationPermissionSubject,
  action: OrganizationPermissionAction
): boolean {
  const role = typeof subject === "string" ? subject : subject.role

  if (role === "owner_admin") {
    return true
  }

  const permissions =
    typeof subject === "string" || subject.customPermissions === null ||
    subject.customPermissions === undefined
      ? permissionsByRole[role]
      : subject.customPermissions

  return permissions.includes(action)
}

/**
 * Whether someone may choose who else can open a document or folder: anyone
 * who can edit it, and anyone who manages folders, while it is in use.
 *
 * @param subject - Current member role and optional custom permissions.
 * @param item - Their access to the item, and where it is in its life.
 * @returns True when they may share it.
 */
export function canShareResource(
  subject: OrganizationPermissionSubject,
  item: { accessLevel?: string | null; lifecycleState: string }
): boolean {
  return (
    item.lifecycleState === "active" &&
    (item.accessLevel === "contributor" || canPerformOrganizationAction(subject, "folders:manage"))
  )
}

/**
 * Whether a member may send a document out, for signing or to answer: they
 * may send documents and edit this one, and it is not archived or in Trash.
 *
 * @param subject - The member's role and permissions.
 * @param item - The document's access level for them and its lifecycle.
 * @returns True when Send is offered.
 */
export function canSendDocument(
  subject: OrganizationPermissionSubject,
  item: { accessLevel?: string | null; lifecycleState: string }
): boolean {
  return canPerformOrganizationAction(subject, "documents:send") && item.accessLevel === "contributor" && item.lifecycleState === "active"
}

/**
 * Returns the legacy base role used for row-scope and workflow rules.
 *
 * @param subject - Static or editable organization permission subject.
 * @returns The subject's persisted base role.
 */
export function getOrganizationRoleFromSubject(
  subject: OrganizationPermissionSubject
): OrganizationRole {
  return typeof subject === "string" ? subject : subject.role
}

/**
 * Checks whether a member role subject can invite users into an organization.
 *
 * @param subject - Current member role and optional custom permissions.
 * @returns True when the subject can create staff invites.
 */
export function canInviteMembers(
  subject: OrganizationPermissionSubject
): boolean {
  return canPerformOrganizationAction(subject, "members:invite")
}

/**
 * Base roles whose database row scope stays inside each base role's own.
 * Custom roles run on Staff row scope, so this is what stops a Staff-scoped
 * inviter from minting a Manager, whose policies reach tenant-wide rows.
 */
const assignableBaseRolesByActorRole: Record<
  Exclude<OrganizationRole, "owner_admin">,
  readonly OrganizationRole[]
> = {
  manager: ["manager", "staff", "external_reviewer"],
  staff: ["staff"],
  external_reviewer: ["external_reviewer"],
}

/**
 * Checks whether an actor may hand a role definition to someone else.
 *
 * Owner is never assignable, and an Owner may assign every other role.
 * Anyone else stays inside their own authority on both axes the product
 * enforces: every permission the role grants must be one the actor currently
 * holds, and the role's base row scope must not reach further than theirs.
 *
 * @param actor - The assigning member's current permission subject.
 * @param target - The role definition being assigned.
 * @returns True when assigning the role cannot widen the actor's own access.
 */
export function canAssignOrganizationRole(
  actor: OrganizationPermissionSubject,
  target: {
    systemKey: OrganizationRole | null
    permissions: readonly OrganizationPermissionAction[] | null
  }
): boolean {
  if (target.systemKey === "owner_admin" || target.permissions === null) {
    return false
  }

  const actorRole = getOrganizationRoleFromSubject(actor)

  if (actorRole === "owner_admin") {
    return true
  }

  return (
    assignableBaseRolesByActorRole[actorRole].includes(
      target.systemKey ?? "staff"
    ) &&
    target.permissions.every((permission) =>
      canPerformOrganizationAction(actor, permission)
    )
  )
}

/**
 * Returns roles that can be assigned from the People page.
 *
 * @returns Assignable roles, excluding owner_admin for MVP safety.
 */
export function getAssignableOrganizationRoles(): readonly OrganizationRole[] {
  return assignableOrganizationRoles
}
