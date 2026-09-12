import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

import { createClient } from "@supabase/supabase-js"

const ENV_FILE = ".env.local"
const OPT_IN_VALUE = "synthetic-test-fixtures"
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "BIZFLOW_RLS_TEST_CONFIRM",
  "BIZFLOW_RLS_OWNER_EMAIL",
  "BIZFLOW_RLS_OWNER_PASSWORD",
  "BIZFLOW_RLS_MANAGER_EMAIL",
  "BIZFLOW_RLS_MANAGER_PASSWORD",
  "BIZFLOW_RLS_ACTOR_A_EMAIL",
  "BIZFLOW_RLS_ACTOR_A_PASSWORD",
  "BIZFLOW_RLS_ACTOR_A_ORG_ID",
  "BIZFLOW_RLS_REVIEWER_EMAIL",
  "BIZFLOW_RLS_REVIEWER_PASSWORD",
  "BIZFLOW_RLS_ACTOR_B_EMAIL",
  "BIZFLOW_RLS_ACTOR_B_PASSWORD",
  "BIZFLOW_RLS_ACTOR_B_ORG_ID"
]

/**
 * Every tenant table signed-in sessions must not read or write directly: exactly
 * the tables 20260912194858_close_direct_tenant_table_access.sql revokes. Tenant
 * data reaches signed-in users only through services, which check each
 * member's current role-definition permissions.
 */
export const DIRECT_ACCESS_CLOSED_TABLES = Object.freeze([
  "audit_logs",
  "document_activity_events",
  "document_answers",
  "document_comments",
  "document_recent_accesses",
  "document_signing_recipients",
  "document_templates",
  "document_versions",
  "documents",
  "folders",
  "generated_document_finalizations",
  "invites",
  "notification_deliveries",
  "organization_memberships",
  "organization_roles",
  "organizations",
  "profiles",
  "public_form_links",
  "resource_purge_jobs",
  "resource_purge_receipts",
  "resource_purge_tombstones",
  "submission_activity_events",
  "submission_comments",
  "submission_files",
  "submissions",
  "task_reminders",
  "tasks",
  "template_flow_messages"
])

/** Service-only submission RPCs that ordinary authenticated sessions must not execute. */
export const AUTHENTICATED_SUBMISSION_RPC_NAMES = Object.freeze([
  "create_internal_submission_draft",
  "save_internal_submission_draft",
  "allocate_internal_submission_file",
  "complete_internal_submission_file",
  "supersede_internal_submission_file",
  "record_internal_submission_file_upload_window",
  "mark_internal_submission_file_storage_cleaned",
  "submit_internal_submission",
  "assign_internal_submission",
  "transition_internal_submission",
  "create_internal_submission_comment"
])

/** Upload-barrier RPCs that must remain unavailable to browser sessions. */
export const AUTHENTICATED_UPLOAD_BARRIER_RPC_NAMES = Object.freeze([
  "register_document_version_upload_authorization",
  "reconcile_document_upload_authorization_barriers"
])

/** Row-security helpers that lost their only signed-in callers with direct access. */
export const AUTHENTICATED_POLICY_HELPER_RPC_NAMES = Object.freeze([
  "is_organization_member",
  "organization_role_for",
  "shares_organization_with_profile"
])

/** Direct Data API mutations that must remain closed on all submission workflow tables. */
export const DIRECT_SUBMISSION_WRITE_PLAN = Object.freeze([
  { table: "submissions", operation: "insert" },
  { table: "submissions", operation: "update" },
  { table: "submissions", operation: "delete" },
  { table: "submission_files", operation: "insert" },
  { table: "submission_files", operation: "update" },
  { table: "submission_files", operation: "delete" },
  { table: "submission_comments", operation: "insert" },
  { table: "submission_comments", operation: "update" },
  { table: "submission_comments", operation: "delete" },
  { table: "submission_activity_events", operation: "insert" },
  { table: "submission_activity_events", operation: "update" },
  { table: "submission_activity_events", operation: "delete" }
])

/** Direct Data API mutations that must remain closed on public form links. */
export const DIRECT_PUBLIC_LINK_WRITE_PLAN = Object.freeze([
  { table: "public_form_links", operation: "insert" },
  { table: "public_form_links", operation: "update" },
  { table: "public_form_links", operation: "delete" }
])

export const HELP_TEXT = `BizFlow authenticated two-tenant Supabase direct-access check

Usage:
  pnpm supabase:check:rls

Required environment:
  SUPABASE_URL                         HTTPS URL for the Supabase project
  SUPABASE_PUBLISHABLE_KEY             Publishable key (never a secret/service-role key)
  BIZFLOW_RLS_TEST_CONFIRM             Must equal: ${OPT_IN_VALUE}
  BIZFLOW_RLS_OWNER_EMAIL              Same-organization synthetic owner_admin user
  BIZFLOW_RLS_OWNER_PASSWORD           Password for the owner fixture
  BIZFLOW_RLS_MANAGER_EMAIL            Same-organization synthetic manager user
  BIZFLOW_RLS_MANAGER_PASSWORD         Password for the manager fixture
  BIZFLOW_RLS_ACTOR_A_EMAIL            Email for a synthetic test user with the staff role
  BIZFLOW_RLS_ACTOR_A_PASSWORD         Password for actor A
  BIZFLOW_RLS_ACTOR_A_ORG_ID           Synthetic organization containing actor A
  BIZFLOW_RLS_REVIEWER_EMAIL           Same-organization external_reviewer user
  BIZFLOW_RLS_REVIEWER_PASSWORD        Password for the reviewer fixture
  BIZFLOW_RLS_ACTOR_B_EMAIL            Email for a different synthetic test user
  BIZFLOW_RLS_ACTOR_B_PASSWORD         Password for actor B
  BIZFLOW_RLS_ACTOR_B_ORG_ID           A different synthetic organization containing actor B

Fixture contract:
  - All users and both organizations must be synthetic, pre-provisioned test fixtures.
  - Owner, manager, actor A, and reviewer must have exactly their named active role in actor A's organization.
  - Actor B must be an active member only in the other organization.
  - Actor identities and organization IDs must be distinct.

What it proves:
  - Every signed-in role in both organizations is denied direct reads of every tenant table.
  - Direct writes to submission tables and public form links are denied.
  - Service-only RPCs and the row-security helpers cannot be executed by signed-in sessions.
  - Tenant data reaches signed-in users only through the service layer; custom-role grant
    and revocation behavior is proven by the service test suite.

Safety and scope:
  - Every request uses an ordinary authenticated session and the publishable key.
  - The script never prints credentials, tokens, IDs, or returned row bodies.
  - No fixture rows are created, updated, or deleted.
  - Every denied insert uses fresh nonexistent foreign keys, and update/delete probes target
    fresh nonexistent IDs, so an unexpectedly open boundary still cannot mutate real fixtures.
  - All local sessions are cleared in a finally block.
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
      Object.entries(processEnvironment).filter(
        ([, value]) => value !== undefined
      )
    )
  }
}

/**
 * Validate the explicit opt-in, credentials contract, and synthetic tenant identifiers.
 *
 * @param {Record<string, string | undefined>} environment - Effective environment values.
 * @returns {{
 *   supabaseUrl: string,
 *   publishableKey: string,
 *   owner: { label: string, email: string, password: string, organizationId: string },
 *   manager: { label: string, email: string, password: string, organizationId: string },
 *   actorA: { label: string, email: string, password: string, organizationId: string },
 *   reviewer: { label: string, email: string, password: string, organizationId: string },
 *   actorB: { label: string, email: string, password: string, organizationId: string }
 * }} Validated harness configuration.
 * @throws {Error} When any required or safety-critical value is missing or invalid.
 */
export function buildConfiguration(environment) {
  const missingKeys = REQUIRED_ENV_KEYS.filter(
    (key) => !environment[key]?.trim()
  )

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required RLS check env keys: ${missingKeys.join(", ")}. Run with --help for the fixture contract.`
    )
  }

  const supabaseUrl = environment.SUPABASE_URL.trim()
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY.trim()
  const ownerEmail = environment.BIZFLOW_RLS_OWNER_EMAIL.trim().toLowerCase()
  const managerEmail =
    environment.BIZFLOW_RLS_MANAGER_EMAIL.trim().toLowerCase()
  const actorAEmail = environment.BIZFLOW_RLS_ACTOR_A_EMAIL.trim().toLowerCase()
  const reviewerEmail =
    environment.BIZFLOW_RLS_REVIEWER_EMAIL.trim().toLowerCase()
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

  if (
    [actorAOrganizationId, actorBOrganizationId].some(
      (identifier) => !UUID_PATTERN.test(identifier)
    )
  ) {
    throw new Error("Configured organization IDs must be UUIDs.")
  }

  const actorEmails = [
    ownerEmail,
    managerEmail,
    actorAEmail,
    reviewerEmail,
    actorBEmail
  ]

  if (new Set(actorEmails).size !== actorEmails.length) {
    throw new Error("Every RLS actor must use a different authentication user.")
  }

  if (actorAOrganizationId === actorBOrganizationId) {
    throw new Error("The two RLS actors must use different organizations.")
  }

  return {
    supabaseUrl,
    publishableKey,
    owner: {
      label: "actor-a-owner",
      email: ownerEmail,
      password: environment.BIZFLOW_RLS_OWNER_PASSWORD,
      organizationId: actorAOrganizationId
    },
    manager: {
      label: "actor-a-manager",
      email: managerEmail,
      password: environment.BIZFLOW_RLS_MANAGER_PASSWORD,
      organizationId: actorAOrganizationId
    },
    actorA: {
      label: "actor-a-staff",
      email: actorAEmail,
      password: environment.BIZFLOW_RLS_ACTOR_A_PASSWORD,
      organizationId: actorAOrganizationId
    },
    reviewer: {
      label: "actor-a-reviewer",
      email: reviewerEmail,
      password: environment.BIZFLOW_RLS_REVIEWER_PASSWORD,
      organizationId: actorAOrganizationId
    },
    actorB: {
      label: "actor-b-internal",
      email: actorBEmail,
      password: environment.BIZFLOW_RLS_ACTOR_B_PASSWORD,
      organizationId: actorBOrganizationId
    }
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
  console.log(
    `[actor=${actorLabel} assertion=${assertion}] pass duration_ms=${durationMs}`
  )
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
    password: actor.password
  })

  if (error || !data.session || !data.user) {
    throw createSafeSupabaseError(
      `${actor.label} authentication`,
      error,
      error?.status
    )
  }

  logPass(actor.label, "password-session", startedAt)
  return { id: data.user.id }
}

/**
 * Verify one signed-in actor is denied direct reads of every tenant table.
 *
 * @param {ReturnType<typeof createClient>} client - Ordinary authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @returns {Promise<void>}
 * @throws {Error} When any table answers a direct read instead of PostgreSQL code 42501.
 */
async function expectDirectReadsDenied(client, actorLabel) {
  for (const table of DIRECT_ACCESS_CLOSED_TABLES) {
    const startedAt = performance.now()
    const { data, error, status } = await client.from(table).select("*").limit(1)

    if (error?.code !== "42501" || data !== null) {
      throw new Error(
        `${actorLabel} direct-${table}-read expected code=42501; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
      )
    }

    logPass(actorLabel, `direct-${table}-read-denied`, startedAt)
  }
}

/**
 * Build null-only RPC arguments that reach validation only if EXECUTE was accidentally granted.
 *
 * @param {string} functionName - Service-only or row-security helper RPC name.
 * @returns {Record<string, null>} Exact PostgREST RPC arguments.
 * @throws {Error} When the assertion plan contains an unknown RPC.
 */
function buildDeniedRpcArguments(functionName) {
  const argumentsByFunction = {
    create_internal_submission_draft: {
      target_org_id: null,
      target_template_id: null,
      target_submission_id: null,
      target_title: null,
      target_actor_user_id: null
    },
    save_internal_submission_draft: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null
    },
    allocate_internal_submission_file: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_file_id: null,
      target_field_key: null,
      target_original_filename: null,
      target_safe_filename: null,
      target_content_type: null,
      target_byte_size: null,
      target_storage_key: null,
      target_expected_checksum_sha256: null,
      target_actor_user_id: null
    },
    complete_internal_submission_file: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_storage_key: null,
      target_content_type: null,
      target_byte_size: null,
      target_checksum_sha256: null,
      target_actor_user_id: null
    },
    supersede_internal_submission_file: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_actor_user_id: null
    },
    record_internal_submission_file_upload_window: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_cleanup_after: null,
      target_actor_user_id: null
    },
    mark_internal_submission_file_storage_cleaned: {
      target_file_id: null,
      target_storage_key: null
    },
    submit_internal_submission: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null
    },
    assign_internal_submission: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_assignee_user_id: null,
      target_actor_user_id: null
    },
    transition_internal_submission: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_transition: null,
      target_comment: null,
      target_actor_user_id: null
    },
    create_internal_submission_comment: {
      target_org_id: null,
      target_submission_id: null,
      target_comment_id: null,
      target_body: null,
      target_actor_user_id: null
    },
    register_document_version_upload_authorization: {
      target_org_id: null,
      target_document_id: null,
      target_version_id: null,
      target_uploaded_by: null,
      target_expires_at: null
    },
    reconcile_document_upload_authorization_barriers: {
      target_conservative_until: null
    },
    is_organization_member: { target_org_id: null },
    organization_role_for: { target_org_id: null },
    shares_organization_with_profile: { target_user_id: null }
  }
  const rpcArguments = argumentsByFunction[functionName]

  if (!rpcArguments) {
    throw new Error(
      `Unknown authenticated RPC-denial assertion: ${functionName}.`
    )
  }

  return rpcArguments
}

/**
 * Verify every service-only RPC and row-security helper remains unavailable to
 * authenticated users.
 *
 * @param {ReturnType<typeof createClient>} client - Ordinary authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @returns {Promise<void>}
 * @throws {Error} When any RPC executes or returns a non-permission failure.
 */
async function expectServiceOnlyRpcsDenied(client, actorLabel) {
  const serviceOnlyFunctionNames = [
    ...AUTHENTICATED_SUBMISSION_RPC_NAMES,
    ...AUTHENTICATED_UPLOAD_BARRIER_RPC_NAMES,
    ...AUTHENTICATED_POLICY_HELPER_RPC_NAMES
  ]

  for (const functionName of serviceOnlyFunctionNames) {
    const startedAt = performance.now()
    const { data, error, status } = await client.rpc(
      functionName,
      buildDeniedRpcArguments(functionName)
    )

    // PostgREST may hide a revoked function from the role or surface PostgreSQL 42501.
    const denied = error?.code === "42501" || error?.code === "PGRST202"

    if (!denied || data !== null) {
      throw new Error(
        `${actorLabel} ${functionName} expected authenticated EXECUTE denial; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
      )
    }

    logPass(actorLabel, `${functionName}-execute-denied`, startedAt)
  }
}

/**
 * Build a constraint-safe insert probe whose fresh foreign keys prevent persistence.
 *
 * @param {"submissions" | "submission_files" | "submission_comments" | "submission_activity_events" | "public_form_links"} table - Table under test.
 * @param {{ organizationId: string }} actor - Synthetic actor metadata.
 * @param {string} actorUserId - Authenticated actor identifier.
 * @returns {Record<string, unknown>} Non-persisting insert body.
 */
function buildDeniedInsertPayload(table, actor, actorUserId) {
  if (table === "submissions") {
    return {
      id: randomUUID(),
      org_id: actor.organizationId,
      title: "Authenticated write denial probe",
      template_id: randomUUID(),
      template_revision: 1,
      template_snapshot: {
        schemaVersion: 2,
        branding: {
          organizationName: "",
          logoDataUrl: null,
          logoAlignment: "left",
          logoWidthPercent: 24,
          primaryColor: "#252329",
          accentColor: "#635273"
        },
        blocks: []
      },
      values: {},
      status: "draft",
      revision: 1,
      created_by: actorUserId,
      updated_by: actorUserId
    }
  }

  if (table === "public_form_links") {
    return {
      id: randomUUID(),
      org_id: actor.organizationId,
      template_id: randomUUID(),
      token: `rls-denial-probe-${randomUUID()}`,
      created_by: actorUserId
    }
  }

  const submissionId = randomUUID()

  if (table === "submission_files") {
    const fileId = randomUUID()
    const fieldKey = "RlsProbe"
    const safeFilename = "rls-probe.pdf"

    return {
      id: fileId,
      org_id: actor.organizationId,
      submission_id: submissionId,
      field_key: fieldKey,
      status: "upload_pending",
      storage_key:
        `organizations/${actor.organizationId}/submissions/${submissionId}` +
        `/files/${fieldKey}/${fileId}/${safeFilename}`,
      original_filename: "rls-probe.pdf",
      safe_filename: safeFilename,
      content_type: "application/pdf",
      byte_size: 1,
      uploaded_by: actorUserId
    }
  }

  if (table === "submission_comments") {
    return {
      id: randomUUID(),
      org_id: actor.organizationId,
      submission_id: submissionId,
      body: "Authenticated write denial probe",
      created_by: actorUserId
    }
  }

  return {
    id: randomUUID(),
    org_id: actor.organizationId,
    submission_id: submissionId,
    actor_user_id: actorUserId,
    event_type: "submitted",
    from_status: "draft",
    to_status: "submitted",
    submission_revision: 1
  }
}

/**
 * Build a column-valid update body so a denial comes from privileges, not from
 * PostgREST rejecting an unknown column.
 *
 * @param {string} table - Table under test.
 * @returns {Record<string, unknown>} Update body.
 */
function buildDeniedUpdatePayload(table) {
  if (table === "submission_comments") {
    return { body: "Authenticated update denial probe" }
  }

  if (table === "submission_activity_events") {
    return { event_type: "commented" }
  }

  if (table === "public_form_links") {
    return { max_submissions: 1 }
  }

  return { updated_at: new Date(0).toISOString() }
}

/**
 * Verify direct authenticated INSERT, UPDATE, and DELETE remain denied for
 * submission data and public form links.
 *
 * @param {ReturnType<typeof createClient>} client - Ordinary authenticated Supabase client.
 * @param {{ label: string, organizationId: string }} actor - Manager fixture metadata.
 * @param {string} actorUserId - Authenticated actor identifier.
 * @returns {Promise<void>}
 * @throws {Error} When any direct mutation is not rejected with PostgreSQL code 42501.
 */
async function expectDirectWritesDenied(client, actor, actorUserId) {
  for (const probe of [
    ...DIRECT_SUBMISSION_WRITE_PLAN,
    ...DIRECT_PUBLIC_LINK_WRITE_PLAN
  ]) {
    const startedAt = performance.now()
    let result

    if (probe.operation === "insert") {
      result = await client
        .from(probe.table)
        .insert(buildDeniedInsertPayload(probe.table, actor, actorUserId))
        .select("id")
    } else if (probe.operation === "update") {
      result = await client
        .from(probe.table)
        .update(buildDeniedUpdatePayload(probe.table))
        .eq("id", randomUUID())
        .select("id")
    } else {
      result = await client
        .from(probe.table)
        .delete()
        .eq("id", randomUUID())
        .select("id")
    }

    const { data, error, status } = result

    if (
      !error ||
      error.code !== "42501" ||
      (Array.isArray(data) && data.length > 0)
    ) {
      throw new Error(
        `${actor.label} direct-${probe.table}-${probe.operation} expected code=42501; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
      )
    }

    logPass(
      actor.label,
      `direct-${probe.table}-${probe.operation}-denied`,
      startedAt
    )
  }
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
      status: "active"
    })
    .select("id")

  if (
    !error ||
    error.code !== "42501" ||
    (Array.isArray(data) && data.length > 0)
  ) {
    throw new Error(
      `actor-a-staff direct-membership-write expected code=42501; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
    )
  }

  logPass(actor.label, "direct-membership-write-denied", startedAt)
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
    console.warn(
      `[actor=${actorLabel} cleanup=session] warning unexpected-cleanup-failure`
    )
  }
}

/**
 * Execute the authenticated two-tenant direct-access verification.
 *
 * @param {ReturnType<typeof buildConfiguration>} configuration - Validated harness settings.
 * @returns {Promise<void>}
 * @throws {Error} When authentication fails or any direct read, write, or RPC is not denied.
 */
export async function runHarness(configuration) {
  const startedAt = performance.now()
  const clientOptions = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  }
  const actorDefinitions = {
    owner: configuration.owner,
    manager: configuration.manager,
    staff: configuration.actorA,
    reviewer: configuration.reviewer,
    tenantB: configuration.actorB
  }
  const clients = Object.fromEntries(
    Object.keys(actorDefinitions).map((actorKey) => [
      actorKey,
      createClient(
        configuration.supabaseUrl,
        configuration.publishableKey,
        clientOptions
      )
    ])
  )

  try {
    const authenticatedActorEntries = []

    // Authenticate sequentially so finally never races with unfinished sign-in requests.
    for (const [actorKey, actor] of Object.entries(actorDefinitions)) {
      authenticatedActorEntries.push([
        actorKey,
        await authenticateActor(clients[actorKey], actor)
      ])
    }

    const authenticatedActors = Object.fromEntries(authenticatedActorEntries)
    const authenticatedUserIds = Object.values(authenticatedActors).map(
      (user) => user.id
    )

    if (new Set(authenticatedUserIds).size !== authenticatedUserIds.length) {
      throw new Error(
        "Multiple credentials authenticated as the same user; distinct fixtures are required."
      )
    }

    for (const [actorKey, actor] of Object.entries(actorDefinitions)) {
      await expectDirectReadsDenied(clients[actorKey], actor.label)
    }

    await expectServiceOnlyRpcsDenied(
      clients.manager,
      configuration.manager.label
    )
    await expectDirectWritesDenied(
      clients.manager,
      configuration.manager,
      authenticatedActors.manager.id
    )
    await expectStaffDirectWriteDenied(clients.staff, configuration.actorA)

    const durationMs = Math.round(performance.now() - startedAt)
    console.log(
      `[check=authenticated-two-tenant-direct-access] pass duration_ms=${durationMs}`
    )
  } finally {
    await Promise.all(
      Object.entries(actorDefinitions).map(([actorKey, actor]) =>
        clearSession(clients[actorKey], actor.label)
      )
    )
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
    throw new Error(
      "Unsupported arguments. Run with --help for usage; credentials are env-only."
    )
  }

  const environment = mergeEnvironment(process.env, readEnvFile())
  await runHarness(buildConfiguration(environment))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Unknown authenticated RLS check failure."
    )
    process.exitCode = 1
  })
}
