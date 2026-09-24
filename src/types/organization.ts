import type {
  OrganizationPermissionAction,
  OrganizationRole,
} from "@/lib/permissions"

export type MembershipStatus = "active" | "disabled"
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired"

export type Organization = {
  id: string
  name: string
  slug: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type OrganizationMembership = {
  id: string
  organizationId: string
  userId: string
  role: OrganizationRole
  roleDefinitionId?: string | null
  roleName?: string | null
  customPermissions?: OrganizationPermissionAction[] | null
  workspaceDisplayName?: string | null
  status: MembershipStatus
  emailNotificationsEnabled?: boolean
  smsNotificationsEnabled?: boolean
  createdAt: string
  updatedAt: string
}

export type OrganizationContext = {
  organization: Organization
  membership: OrganizationMembership
}

export type OrganizationMember = {
  id: string
  userId: string
  email: string
  fullName: string | null
  workspaceDisplayName?: string | null
  phoneNumber?: string | null
  role: OrganizationRole
  roleDefinitionId?: string | null
  roleName?: string | null
  status: MembershipStatus
  createdAt: string
}

export type OrganizationRoleDefinition = {
  id: string
  organizationId: string
  systemKey: OrganizationRole | null
  name: string
  permissions: OrganizationPermissionAction[] | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export type OrganizationInvite = {
  id: string
  organizationId: string
  email: string
  role: OrganizationRole
  roleDefinitionId?: string | null
  roleName?: string | null
  token: string
  invitedBy?: string | null
  status: InviteStatus
  expiresAt: string
  createdAt: string
}

export type InvitePreview = {
  id: string
  organizationName: string
  email: string
  role: OrganizationRole
  roleName?: string | null
  expiresAt: string
}
