export const ORGANIZATION_ROLES = [
  "owner_admin",
  "manager",
  "staff",
  "external_reviewer",
] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

export const ORGANIZATION_PERMISSION_ACTIONS = [
  "people:view",
  "members:invite",
  "members:update_role",
  "audit_logs:view",
  // Chain verification is an incident-response signal for the tenant owner;
  // owner_admin receives it through the full-array grant below.
  "audit_logs:verify",
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
  "submissions:view",
  "submissions:create",
  "submissions:edit",
  "submissions:assign",
  "submissions:review",
  "submission_comments:create",
] as const

export type OrganizationPermissionAction =
  (typeof ORGANIZATION_PERMISSION_ACTIONS)[number]

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
  ],
  staff: [
    "people:view",
    "templates:view",
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
  ],
  external_reviewer: [
    "people:view",
    "documents:view",
    "documents:fill",
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
 * Checks whether a role can perform an organization action.
 *
 * @param role - Current member role.
 * @param action - Organization permission action to check.
 * @returns True when the action is allowed for the role.
 */
export function canPerformOrganizationAction(
  role: OrganizationRole,
  action: OrganizationPermissionAction
): boolean {
  return permissionsByRole[role].includes(action)
}

/**
 * Checks whether a member role can invite users into an organization.
 *
 * @param role - Current member role.
 * @returns True when the role can create staff invites.
 */
export function canInviteMembers(role: OrganizationRole): boolean {
  return canPerformOrganizationAction(role, "members:invite")
}

/**
 * Checks whether a member role can update another member's role.
 *
 * @param role - Current member role.
 * @returns True when the role can change member roles.
 */
export function canUpdateMemberRole(role: OrganizationRole): boolean {
  return canPerformOrganizationAction(role, "members:update_role")
}

/**
 * Returns roles that can be assigned from the People page.
 *
 * @returns Assignable roles, excluding owner_admin for MVP safety.
 */
export function getAssignableOrganizationRoles(): readonly OrganizationRole[] {
  return assignableOrganizationRoles
}
