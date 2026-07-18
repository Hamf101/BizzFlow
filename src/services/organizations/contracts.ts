import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { OrganizationRole } from "@/lib/permissions"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"
import type { OrganizationInvite, OrganizationMember } from "@/types/organization"

export type OrganizationServiceClient = AdminSupabaseClient

export type LogValue = string | number | boolean | null | undefined

export type SupabaseErrorLike = {
  code?: string
  details?: string
  hint?: string
  message?: string
}

export type OrganizationRow = {
  id: string
  name: string
  slug: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
}

export type MembershipRow = {
  id: string
  org_id: string
  user_id: string
  role: string
  status: string
  created_at: string
  updated_at: string
}

export type InviteRow = {
  id: string
  org_id: string
  email: string
  role: string
  token: string
  status: string
  expires_at: string
  created_at: string
}

export type CreateOrganizationInput = {
  userId: string
  userEmail: string | null
  name: string
}

export type CreateInviteInput = {
  actorUserId: string
  organizationId: string
  email: string
  role: OrganizationRole
}

export type AcceptInviteInput = {
  userId: string
  userEmail: string | null
  token: string
}

export type UpdateMemberRoleInput = {
  actorUserId: string
  organizationId: string
  membershipId: string
  role: OrganizationRole
}

export type OrganizationAuditLogInput = {
  organizationId: string
  actorUserId: string | null
  action: AuditLogAction
  targetType: AuditLogTargetType
  targetId: string
  metadata: AuditMetadata
}

export type OrganizationMutationDeps = {
  client?: OrganizationServiceClient
  recordAuditLog?: (input: OrganizationAuditLogInput) => Promise<unknown>
}

export type OrganizationPeople = {
  members: OrganizationMember[]
  pendingInvites: OrganizationInvite[]
}
