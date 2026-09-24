import type { AdminSupabaseClient } from "@/lib/supabase/admin"
import type { SendInviteEmailInput } from "@/services/invite-email-service"
import type {
  OrganizationPermissionAction,
  OrganizationRole,
} from "@/lib/permissions"
import type {
  AuditLogAction,
  AuditLogTargetType,
  AuditMetadata,
} from "@/types/audit"
import type {
  OrganizationInvite,
  OrganizationMember,
  OrganizationRoleDefinition,
} from "@/types/organization"

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
  role_definition_id?: string | null
  workspace_display_name?: string | null
  role_definition?: {
    id: string
    name: string
    system_key: string | null
    permissions: string[] | null
  } | null
  status: string
  created_at: string
  updated_at: string
}

export type OrganizationRoleRow = {
  id: string
  org_id: string
  system_key: string | null
  name: string
  permissions: string[] | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type InviteRow = {
  id: string
  org_id: string
  email: string
  role: string
  role_definition_id?: string | null
  role_definition?: {
    id: string
    name: string
    system_key: string | null
  } | null
  token: string
  invited_by?: string | null
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
  roleId: string
}

export type RevokeInviteInput = {
  actorUserId: string
  organizationId: string
  inviteId: string
}

/**
 * Outcome of creating an invite.
 *
 * `emailDelivered` is false when the invite exists and is usable but the
 * notification could not be sent, so the caller can offer the link instead.
 */
export type CreateInviteResult = {
  invite: OrganizationInvite
  emailDelivered: boolean
  emailFailureReason: string | null
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

export type CreateOrganizationRoleInput = {
  actorUserId: string
  organizationId: string
  name: string
  permissions: OrganizationPermissionAction[]
}

export type UpdateOrganizationRoleInput = {
  actorUserId: string
  organizationId: string
  roleId: string
  name: string
  permissions?: OrganizationPermissionAction[]
}

export type ArchiveOrganizationRoleInput = {
  actorUserId: string
  organizationId: string
  roleId: string
}

export type UpdateMemberAccessInput = {
  actorUserId: string
  organizationId: string
  membershipId: string
  roleId: string
  workspaceDisplayName: string | null
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
  createInviteToken?: () => string
  now?: () => Date
  recordAuditLog?: (input: OrganizationAuditLogInput) => Promise<unknown>
  sendInviteEmail?: (input: SendInviteEmailInput) => Promise<void>
}

export type OrganizationPeople = {
  members: OrganizationMember[]
  invites: OrganizationInvite[]
  roles: OrganizationRoleDefinition[]
}
