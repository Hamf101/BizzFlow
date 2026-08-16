import { randomUUID } from "node:crypto"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Seeding for the disposable tenant every spec runs against.
 *
 * Rows are written with the service-role key, which bypasses RLS. That is
 * correct for a fixture — the point is to arrive at a known starting state
 * cheaply — but it means seeding proves nothing about tenant isolation. The
 * specs themselves exercise the app through the browser as a real member, so
 * every permission check they cross is the genuine one.
 */

export const ORGANIZATION_ROLES = [
  "owner_admin",
  "manager",
  "staff",
  "external_reviewer",
] as const

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number]

export type SeededUser = {
  email: string
  id: string
  password: string
  role: OrganizationRole
}

export type SeededTenant = {
  organizationId: string
  organizationName: string
  users: Record<OrganizationRole, SeededUser>
}

// Long enough for the signup schema's 8-character minimum with room to spare.
const SEED_PASSWORD = "e2e-BizFlow-Passw0rd"

/**
 * Creates a Supabase client that bypasses RLS.
 *
 * @returns Service-role client bound to the local stack.
 * @throws Error when the E2E environment is not configured.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set. Run `pnpm e2e:env` " +
        "after starting the local stack with `pnpm e2e:up`."
    )
  }

  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Creates one organization with an active member for every role.
 *
 * @param client - Service-role client.
 * @param label - Short suffix that keeps concurrent runs from colliding.
 * @returns Handles for the organization and each seeded member.
 */
export async function seedTenant(
  client: SupabaseClient,
  label: string = randomUUID().slice(0, 8)
): Promise<SeededTenant> {
  const organizationName = `E2E ${label}`
  const organizationId = await insertOrganization(
    client,
    organizationName,
    `e2e-${label.toLowerCase()}`
  )

  const users = {} as Record<OrganizationRole, SeededUser>

  for (const role of ORGANIZATION_ROLES) {
    users[role] = await insertMember(client, organizationId, role, label)
  }

  // The owner column is nullable and set separately so the organization row can
  // exist before any profile does — profiles reference auth.users, and the
  // owner's auth record is created in the loop above.
  await client
    .from("organizations")
    .update({ created_by: users.owner_admin.id })
    .eq("id", organizationId)

  return { organizationId, organizationName, users }
}

/**
 * Removes an organization and every auth user seeded alongside it.
 *
 * @param client - Service-role client.
 * @param tenant - Tenant returned by {@link seedTenant}.
 * @returns Resolves once the tenant is gone.
 */
export async function destroyTenant(
  client: SupabaseClient,
  tenant: SeededTenant
): Promise<void> {
  // Organization rows cascade to memberships, documents, submissions and the
  // rest; auth users do not, so they are deleted explicitly.
  await client.from("organizations").delete().eq("id", tenant.organizationId)

  for (const user of Object.values(tenant.users)) {
    await client.auth.admin.deleteUser(user.id)
  }
}

/**
 * Inserts the organization row.
 *
 * @param client - Service-role client.
 * @param name - Display name.
 * @param slug - URL slug, unique across the database.
 * @returns New organization id.
 */
async function insertOrganization(
  client: SupabaseClient,
  name: string,
  slug: string
): Promise<string> {
  const { data, error } = await client
    .from("organizations")
    .insert({ name, slug })
    .select("id")
    .single()

  if (error) {
    throw new Error(`Could not seed organization: ${error.message}`)
  }

  return data.id as string
}

/**
 * Creates a confirmed auth user, its profile, and an active membership.
 *
 * `email_confirm` matters: without it the user exists but cannot sign in, and
 * the failure surfaces much later as an unexplained redirect back to /login.
 *
 * @param client - Service-role client.
 * @param organizationId - Organization to join.
 * @param role - Role to grant.
 * @param label - Run suffix, kept in the address so leaked rows are traceable.
 * @returns The seeded user's credentials and id.
 */
async function insertMember(
  client: SupabaseClient,
  organizationId: string,
  role: OrganizationRole,
  label: string
): Promise<SeededUser> {
  const email = `${role.replace("_", "-")}-${label}@e2e.bizflow.test`.toLowerCase()

  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    password: SEED_PASSWORD,
  })

  if (error || !data.user) {
    throw new Error(
      `Could not seed ${role} user: ${error?.message ?? "no user returned"}`
    )
  }

  const userId = data.user.id

  // No trigger populates public.profiles from auth.users in this schema — the
  // application does it in ensureProfile — so the fixture has to.
  const { error: profileError } = await client
    .from("profiles")
    .upsert({ email, full_name: `E2E ${role}`, id: userId })

  if (profileError) {
    throw new Error(`Could not seed ${role} profile: ${profileError.message}`)
  }

  const { error: membershipError } = await client
    .from("organization_memberships")
    .insert({ org_id: organizationId, role, status: "active", user_id: userId })

  if (membershipError) {
    throw new Error(
      `Could not seed ${role} membership: ${membershipError.message}`
    )
  }

  return { email, id: userId, password: SEED_PASSWORD, role }
}
