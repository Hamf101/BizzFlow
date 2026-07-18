import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const ENV_FILE = ".env.local"
const OPT_IN_VALUE = "synthetic-test-fixtures"
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "BIZFLOW_RLS_TEST_CONFIRM",
  "BIZFLOW_RLS_ACTOR_A_EMAIL",
  "BIZFLOW_RLS_ACTOR_A_PASSWORD",
  "BIZFLOW_RLS_ACTOR_A_ORG_ID",
  "BIZFLOW_RLS_ACTOR_B_EMAIL",
  "BIZFLOW_RLS_ACTOR_B_PASSWORD",
  "BIZFLOW_RLS_ACTOR_B_ORG_ID",
]

export const HELP_TEXT = `BizFlow authenticated two-tenant Supabase RLS check

Usage:
  pnpm supabase:check:rls

Required environment:
  SUPABASE_URL                         HTTPS URL for the Supabase project
  SUPABASE_PUBLISHABLE_KEY             Publishable key (never a secret/service-role key)
  BIZFLOW_RLS_TEST_CONFIRM             Must equal: ${OPT_IN_VALUE}
  BIZFLOW_RLS_ACTOR_A_EMAIL            Email for a synthetic test user with the staff role
  BIZFLOW_RLS_ACTOR_A_PASSWORD         Password for actor A
  BIZFLOW_RLS_ACTOR_A_ORG_ID           Synthetic organization containing actor A
  BIZFLOW_RLS_ACTOR_B_EMAIL            Email for a different synthetic test user
  BIZFLOW_RLS_ACTOR_B_PASSWORD         Password for actor B
  BIZFLOW_RLS_ACTOR_B_ORG_ID           A different synthetic organization containing actor B

Fixture contract:
  - Both users and organizations must be synthetic, pre-provisioned test fixtures.
  - Each user must have one active membership in its configured organization.
  - Actor A must have the staff role, and neither actor may belong to the other organization.
  - Actor and organization IDs must be distinct.

Safety and scope:
  - Tenant reads always use the two ordinary authenticated sessions and the publishable key.
  - The script never prints credentials, tokens, IDs, or returned row bodies.
  - No fixture rows are created, updated, or deleted.
  - The staff write probe attempts a direct membership insert for a fresh nonexistent user ID.
    It expects PostgreSQL code 42501 from the current authenticated Data API boundary. The
    foreign key prevents persistence if that boundary unexpectedly opens. This verifies the
    direct authenticated-write boundary, not a manager-versus-staff policy: BizFlow routes
    privileged organization writes through trusted server/service-role paths.
`

/**
 * Read simple KEY=VALUE entries from the local environment file.
 *
 * @param {string} path - Environment file path relative to the current working directory.
 * @returns {Record<string, string>} Parsed values without mutating process.env.
 */
export function readEnvFile(path = ENV_FILE) {
  if (!existsSync(path)) {
    return {}
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")])
  )
}

/**
 * Merge file-backed and process environment values, with process values taking precedence.
 *
 * @param {Record<string, string | undefined>} processEnvironment - Usually process.env.
 * @param {Record<string, string>} fileEnvironment - Parsed local environment values.
 * @returns {Record<string, string>} Effective environment values.
 */
export function mergeEnvironment(processEnvironment, fileEnvironment) {
  return {
    ...fileEnvironment,
    ...Object.fromEntries(
      Object.entries(processEnvironment).filter(([, value]) => value !== undefined)
    ),
  }
}

/**
 * Validate the explicit opt-in, credentials contract, and synthetic tenant identifiers.
 *
 * @param {Record<string, string | undefined>} environment - Effective environment values.
 * @returns {{
 *   supabaseUrl: string,
 *   publishableKey: string,
 *   actorA: { label: string, email: string, password: string, organizationId: string },
 *   actorB: { label: string, email: string, password: string, organizationId: string }
 * }} Validated harness configuration.
 * @throws {Error} When any required or safety-critical value is missing or invalid.
 */
export function buildConfiguration(environment) {
  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => !environment[key]?.trim())

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required RLS check env keys: ${missingKeys.join(", ")}. Run with --help for the fixture contract.`
    )
  }

  const supabaseUrl = environment.SUPABASE_URL.trim()
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY.trim()
  const actorAEmail = environment.BIZFLOW_RLS_ACTOR_A_EMAIL.trim().toLowerCase()
  const actorBEmail = environment.BIZFLOW_RLS_ACTOR_B_EMAIL.trim().toLowerCase()
  const actorAOrganizationId = environment.BIZFLOW_RLS_ACTOR_A_ORG_ID.trim()
  const actorBOrganizationId = environment.BIZFLOW_RLS_ACTOR_B_ORG_ID.trim()

  if (environment.BIZFLOW_RLS_TEST_CONFIRM !== OPT_IN_VALUE) {
    throw new Error(
      `RLS check is opt-in. Set BIZFLOW_RLS_TEST_CONFIRM=${OPT_IN_VALUE} only for synthetic fixtures.`
    )
  }

  let parsedUrl

  try {
    parsedUrl = new URL(supabaseUrl)
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTPS URL.")
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS for the cloud RLS check.")
  }

  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY must use the sb_publishable_ format; secret, service-role, and unknown key formats are rejected."
    )
  }

  if (!UUID_PATTERN.test(actorAOrganizationId) || !UUID_PATTERN.test(actorBOrganizationId)) {
    throw new Error("Both configured organization IDs must be UUIDs.")
  }

  if (actorAEmail === actorBEmail) {
    throw new Error("The two RLS actors must use different authentication users.")
  }

  if (actorAOrganizationId === actorBOrganizationId) {
    throw new Error("The two RLS actors must use different organizations.")
  }

  return {
    supabaseUrl,
    publishableKey,
    actorA: {
      label: "actor-a-staff",
      email: actorAEmail,
      password: environment.BIZFLOW_RLS_ACTOR_A_PASSWORD,
      organizationId: actorAOrganizationId,
    },
    actorB: {
      label: "actor-b",
      email: actorBEmail,
      password: environment.BIZFLOW_RLS_ACTOR_B_PASSWORD,
      organizationId: actorBOrganizationId,
    },
  }
}

/**
 * Render a non-sensitive Supabase failure summary.
 *
 * @param {string} context - Safe operation label.
 * @param {{ code?: string, status?: number } | null | undefined} error - Supabase error metadata.
 * @param {number | undefined} status - HTTP status returned by the query wrapper.
 * @returns {Error} Sanitized error that excludes messages, hints, details, and row bodies.
 */
function createSafeSupabaseError(context, error, status) {
  return new Error(
    `${context} failed (status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "unknown"}).`
  )
}

/**
 * Log a completed assertion without exposing fixture identifiers or result data.
 *
 * @param {string} actorLabel - Non-sensitive actor label.
 * @param {string} assertion - Assertion identifier.
 * @param {number} startedAt - performance.now() value captured before the operation.
 * @returns {void}
 */
function logPass(actorLabel, assertion, startedAt) {
  const durationMs = Math.round(performance.now() - startedAt)
  console.log(`[actor=${actorLabel} assertion=${assertion}] pass duration_ms=${durationMs}`)
}

/**
 * Authenticate one ordinary test user without persisting or refreshing its session.
 *
 * @param {ReturnType<typeof createClient>} client - Publishable-key Supabase client.
 * @param {{ label: string, email: string, password: string }} actor - Test actor credentials.
 * @returns {Promise<{ id: string }>} Authenticated user identity.
 * @throws {Error} When authentication does not produce a user session.
 */
async function authenticateActor(client, actor) {
  const startedAt = performance.now()
  const { data, error } = await client.auth.signInWithPassword({
    email: actor.email,
    password: actor.password,
  })

  if (error || !data.session || !data.user) {
    throw createSafeSupabaseError(`${actor.label} authentication`, error, error?.status)
  }

  logPass(actor.label, "password-session", startedAt)
  return { id: data.user.id }
}

/**
 * Require exactly one row to be visible for a targeted fixture query.
 *
 * @param {ReturnType<typeof createClient>} client - Authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @param {string} table - Public table name.
 * @param {string} columns - Minimal selected columns.
 * @param {Record<string, string>} filters - Exact fixture filters.
 * @param {string} assertion - Assertion identifier.
 * @returns {Promise<Record<string, unknown>>} The one visible row, used only for local assertions.
 * @throws {Error} When the query fails or does not return exactly one row.
 */
async function expectOneVisible(client, actorLabel, table, columns, filters, assertion) {
  const startedAt = performance.now()
  const { data, error, status } = await client
    .from(table)
    .select(columns)
    .match(filters)
    .limit(2)

  if (error) {
    throw createSafeSupabaseError(`${actorLabel} ${assertion}`, error, status)
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(
      `${actorLabel} ${assertion} expected exactly one visible row; observed_count=${Array.isArray(data) ? data.length : 0}.`
    )
  }

  logPass(actorLabel, assertion, startedAt)
  return data[0]
}

/**
 * Require a targeted fixture row to be hidden by RLS.
 *
 * @param {ReturnType<typeof createClient>} client - Authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @param {string} table - Public table name.
 * @param {Record<string, string>} filters - Exact fixture filters.
 * @param {string} assertion - Assertion identifier.
 * @returns {Promise<void>}
 * @throws {Error} When the query fails or exposes any matching row.
 */
async function expectHidden(client, actorLabel, table, filters, assertion) {
  const startedAt = performance.now()
  const { data, error, status } = await client
    .from(table)
    .select("id")
    .match(filters)
    .limit(1)

  if (error) {
    throw createSafeSupabaseError(`${actorLabel} ${assertion}`, error, status)
  }

  if (!Array.isArray(data) || data.length !== 0) {
    throw new Error(`${actorLabel} ${assertion} exposed the other tenant fixture.`)
  }

  logPass(actorLabel, assertion, startedAt)
}

/**
 * Verify the current direct authenticated-write boundary with a non-persisting staff probe.
 *
 * @param {ReturnType<typeof createClient>} client - Actor A's authenticated Supabase client.
 * @param {{ label: string, organizationId: string }} actor - Staff fixture metadata.
 * @returns {Promise<void>}
 * @throws {Error} When the expected PostgreSQL privilege/RLS denial is not observed.
 */
async function expectStaffDirectWriteDenied(client, actor) {
  const startedAt = performance.now()
  const { data, error, status } = await client
    .from("organization_memberships")
    .insert({
      org_id: actor.organizationId,
      user_id: randomUUID(),
      role: "manager",
      status: "active",
    })
    .select("id")

  if (!error || error.code !== "42501" || (Array.isArray(data) && data.length > 0)) {
    throw new Error(
      `actor-a-staff direct-membership-write expected code=42501; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
    )
  }

  logPass(actor.label, "direct-membership-write-denied", startedAt)
  console.log(
    "[scope=write-denial] direct authenticated Data API boundary verified; this is not manager-versus-staff RLS evidence"
  )
}

/**
 * Clear a client's in-memory session without printing session or credential material.
 *
 * @param {ReturnType<typeof createClient>} client - Supabase client to sign out locally.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @returns {Promise<void>}
 */
async function clearSession(client, actorLabel) {
  try {
    const { error } = await client.auth.signOut({ scope: "local" })

    if (error) {
      console.warn(
        `[actor=${actorLabel} cleanup=session] warning status=${error.status ?? "unknown"} code=${error.code ?? "unknown"}`
      )
    }
  } catch {
    console.warn(`[actor=${actorLabel} cleanup=session] warning unexpected-cleanup-failure`)
  }
}

/**
 * Execute the authenticated two-tenant RLS verification.
 *
 * @param {ReturnType<typeof buildConfiguration>} configuration - Validated harness settings.
 * @returns {Promise<void>}
 * @throws {Error} When authentication, positive visibility, isolation, or write denial fails.
 */
export async function runHarness(configuration) {
  const startedAt = performance.now()
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }
  const actorAClient = createClient(
    configuration.supabaseUrl,
    configuration.publishableKey,
    clientOptions
  )
  const actorBClient = createClient(
    configuration.supabaseUrl,
    configuration.publishableKey,
    clientOptions
  )

  try {
    const actorAUser = await authenticateActor(actorAClient, configuration.actorA)
    const actorBUser = await authenticateActor(actorBClient, configuration.actorB)

    if (actorAUser.id === actorBUser.id) {
      throw new Error("The two credentials authenticated as the same user; distinct fixtures are required.")
    }

    const actorAMembership = await expectOneVisible(
      actorAClient,
      configuration.actorA.label,
      "organization_memberships",
      "id,role",
      {
        org_id: configuration.actorA.organizationId,
        user_id: actorAUser.id,
        status: "active",
      },
      "own-active-membership-visible"
    )

    if (actorAMembership.role !== "staff") {
      throw new Error("Actor A must have the staff role in its synthetic organization fixture.")
    }

    await expectOneVisible(
      actorBClient,
      configuration.actorB.label,
      "organization_memberships",
      "id",
      {
        org_id: configuration.actorB.organizationId,
        user_id: actorBUser.id,
        status: "active",
      },
      "own-active-membership-visible"
    )

    await expectOneVisible(
      actorAClient,
      configuration.actorA.label,
      "organizations",
      "id",
      { id: configuration.actorA.organizationId },
      "own-organization-visible"
    )
    await expectHidden(
      actorAClient,
      configuration.actorA.label,
      "organizations",
      { id: configuration.actorB.organizationId },
      "other-organization-hidden"
    )
    await expectHidden(
      actorAClient,
      configuration.actorA.label,
      "organization_memberships",
      {
        org_id: configuration.actorB.organizationId,
        user_id: actorBUser.id,
      },
      "other-membership-hidden"
    )
    await expectOneVisible(
      actorBClient,
      configuration.actorB.label,
      "organizations",
      "id",
      { id: configuration.actorB.organizationId },
      "own-organization-visible"
    )
    await expectHidden(
      actorBClient,
      configuration.actorB.label,
      "organizations",
      { id: configuration.actorA.organizationId },
      "other-organization-hidden"
    )
    await expectHidden(
      actorBClient,
      configuration.actorB.label,
      "organization_memberships",
      {
        org_id: configuration.actorA.organizationId,
        user_id: actorAUser.id,
      },
      "other-membership-hidden"
    )

    await expectStaffDirectWriteDenied(actorAClient, configuration.actorA)

    const durationMs = Math.round(performance.now() - startedAt)
    console.log(`[check=authenticated-two-tenant-rls] pass duration_ms=${durationMs}`)
  } finally {
    await Promise.all([
      clearSession(actorAClient, configuration.actorA.label),
      clearSession(actorBClient, configuration.actorB.label),
    ])
  }
}

/**
 * Parse CLI intent, validate environment configuration, and run the live harness.
 *
 * @returns {Promise<void>}
 * @throws {Error} For unsupported CLI arguments or any failed verification.
 */
async function main() {
  const argumentsList = process.argv.slice(2)

  if (argumentsList.includes("--help") || argumentsList.includes("-h")) {
    console.log(HELP_TEXT)
    return
  }

  if (argumentsList.length > 0) {
    throw new Error("Unsupported arguments. Run with --help for usage; credentials are env-only.")
  }

  const environment = mergeEnvironment(process.env, readEnvFile())
  await runHarness(buildConfiguration(environment))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown authenticated RLS check failure.")
    process.exitCode = 1
  })
}
