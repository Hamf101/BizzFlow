import type { OrganizationRole } from "@/lib/permissions"

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
  status: MembershipStatus
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
  role: OrganizationRole
  status: MembershipStatus
  createdAt: string
}

export type OrganizationInvite = {
  id: string
  organizationId: string
  email: string
  role: OrganizationRole
  token: string
  status: InviteStatus
  expiresAt: string
  createdAt: string
}

export type InvitePreview = {
  id: string
  organizationName: string
  email: string
  role: OrganizationRole
  expiresAt: string
}
