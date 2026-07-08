import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js"

import { getAdminSupabaseEnv } from "@/lib/env"

type DatabaseOrganizationRole =
  | "owner_admin"
  | "manager"
  | "staff"
  | "external_reviewer"

type DatabaseMembershipStatus = "active" | "disabled"
type DatabaseInviteStatus = "pending" | "accepted" | "revoked" | "expired"

type DatabaseTable<
  Row extends Record<string, unknown>,
  Insert extends Record<string, unknown>,
  Update extends Record<string, unknown>,
> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type ProfileRow = Record<string, unknown> & {
  id: string
  email: string | null
  full_name: string | null
  created_at: string
  updated_at: string
}

type OrganizationRow = Record<string, unknown> & {
  id: string
  name: string
  slug: string
  created_by: string | null
  created_at: string
  updated_at: string
}

type MembershipRow = Record<string, unknown> & {
  id: string
  org_id: string
  user_id: string
  role: DatabaseOrganizationRole
  status: DatabaseMembershipStatus
  created_at: string
  updated_at: string
}

type InviteRow = Record<string, unknown> & {
  id: string
  org_id: string
  email: string
  role: DatabaseOrganizationRole
  token: string
  invited_by: string | null
  status: DatabaseInviteStatus
  expires_at: string
  accepted_by: string | null
  accepted_at: string | null
  created_at: string
  updated_at: string
}

type AuditLogRow = Record<string, unknown> & {
  id: string
  org_id: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type AdminDatabase = {
  public: {
    Tables: {
      profiles: DatabaseTable<
        ProfileRow,
        Partial<ProfileRow> & Pick<ProfileRow, "id">,
        Partial<ProfileRow>
      >
      organizations: DatabaseTable<
        OrganizationRow,
        Partial<OrganizationRow> & Pick<OrganizationRow, "name" | "slug">,
        Partial<OrganizationRow>
      >
      organization_memberships: DatabaseTable<
        MembershipRow,
        Partial<MembershipRow> & Pick<MembershipRow, "org_id" | "user_id" | "role">,
        Partial<MembershipRow>
      >
      invites: DatabaseTable<
        InviteRow,
        Partial<InviteRow> & Pick<InviteRow, "org_id" | "email" | "role" | "token">,
        Partial<InviteRow>
      >
      audit_logs: DatabaseTable<
        AuditLogRow,
        Partial<AuditLogRow> &
          Pick<AuditLogRow, "org_id" | "action" | "target_type">,
        Partial<AuditLogRow>
      >
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

export type AdminSupabaseClient = SupabaseClient<AdminDatabase>

/**
 * Creates a secret-key Supabase client for trusted server-side workflows.
 *
 * @returns Typed Supabase admin client for server-only data access.
 * @throws Error when required Supabase environment variables are missing.
 */
export function createAdminClient(): AdminSupabaseClient {
  const env = getAdminSupabaseEnv()

  return createSupabaseClient<AdminDatabase>(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
