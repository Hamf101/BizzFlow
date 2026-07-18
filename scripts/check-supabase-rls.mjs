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
  "BIZFLOW_RLS_ACTOR_B_ORG_ID",
  "BIZFLOW_RLS_STAFF_SUBMISSION_ID",
  "BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID",
  "BIZFLOW_RLS_MANAGER_SUBMISSION_ID",
  "BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID",
]

/** Expected submission/file visibility for each synthetic actor and exact fixture pair. */
export const SUBMISSION_VISIBILITY_PLAN = Object.freeze([
  { actor: "owner", fixture: "staff", visible: true },
  { actor: "owner", fixture: "manager", visible: true },
  { actor: "manager", fixture: "staff", visible: true },
  { actor: "manager", fixture: "manager", visible: true },
  { actor: "staff", fixture: "staff", visible: true },
  { actor: "staff", fixture: "manager", visible: false },
  { actor: "reviewer", fixture: "staff", visible: false },
  { actor: "reviewer", fixture: "manager", visible: false },
  { actor: "tenantB", fixture: "staff", visible: false },
  { actor: "tenantB", fixture: "manager", visible: false },
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
])

/** Direct Data API mutations that must remain closed on both submission tables. */
export const DIRECT_SUBMISSION_WRITE_PLAN = Object.freeze([
  { table: "submissions", operation: "insert" },
  { table: "submissions", operation: "update" },
  { table: "submissions", operation: "delete" },
  { table: "submission_files", operation: "insert" },
  { table: "submission_files", operation: "update" },
  { table: "submission_files", operation: "delete" },
])

export const HELP_TEXT = `BizFlow authenticated two-tenant Supabase RLS check

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
  BIZFLOW_RLS_STAFF_SUBMISSION_ID      Submission created by actor A in actor A's organization
  BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID File belonging to the staff-created submission
  BIZFLOW_RLS_MANAGER_SUBMISSION_ID    Submission created by the configured manager
  BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID File belonging to the manager-created submission

Fixture contract:
  - All users and both organizations must be synthetic, pre-provisioned test fixtures.
  - Owner, manager, actor A, and reviewer must have exactly their named active role in actor A's organization.
  - Actor B must be an active owner_admin, manager, or staff member only in the other organization.
  - The two named submissions/files must already exist, be related exactly, and have their named creator.
  - Actor identities, organization IDs, submission IDs, and file IDs must be distinct within each category.

Safety and scope:
  - Tenant reads always use ordinary authenticated sessions and the publishable key.
  - The script never prints credentials, tokens, IDs, or returned row bodies.
  - No fixture rows are created, updated, or deleted.
  - Every denied insert uses fresh nonexistent foreign keys, and update/delete probes target
    fresh nonexistent IDs, so an unexpectedly open boundary still cannot mutate real fixtures.
  - All local sessions are cleared in a finally block; fixture reads target exact configured IDs.
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
 *   owner: { label: string, email: string, password: string, organizationId: string },
 *   manager: { label: string, email: string, password: string, organizationId: string },
 *   actorA: { label: string, email: string, password: string, organizationId: string },
 *   reviewer: { label: string, email: string, password: string, organizationId: string },
 *   actorB: { label: string, email: string, password: string, organizationId: string },
 *   fixtures: {
 *     staff: { label: string, organizationId: string, submissionId: string, fileId: string },
 *     manager: { label: string, organizationId: string, submissionId: string, fileId: string }
 *   }
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
  const ownerEmail = environment.BIZFLOW_RLS_OWNER_EMAIL.trim().toLowerCase()
  const managerEmail = environment.BIZFLOW_RLS_MANAGER_EMAIL.trim().toLowerCase()
  const actorAEmail = environment.BIZFLOW_RLS_ACTOR_A_EMAIL.trim().toLowerCase()
  const reviewerEmail = environment.BIZFLOW_RLS_REVIEWER_EMAIL.trim().toLowerCase()
  const actorBEmail = environment.BIZFLOW_RLS_ACTOR_B_EMAIL.trim().toLowerCase()
  const actorAOrganizationId = environment.BIZFLOW_RLS_ACTOR_A_ORG_ID.trim()
  const actorBOrganizationId = environment.BIZFLOW_RLS_ACTOR_B_ORG_ID.trim()
  const staffSubmissionId = environment.BIZFLOW_RLS_STAFF_SUBMISSION_ID.trim()
  const staffFileId = environment.BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID.trim()
  const managerSubmissionId = environment.BIZFLOW_RLS_MANAGER_SUBMISSION_ID.trim()
  const managerFileId = environment.BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID.trim()

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

  const configuredIds = [
    actorAOrganizationId,
    actorBOrganizationId,
    staffSubmissionId,
    staffFileId,
    managerSubmissionId,
    managerFileId,
  ]

  if (configuredIds.some((identifier) => !UUID_PATTERN.test(identifier))) {
    throw new Error("Configured organization, submission, and file IDs must be UUIDs.")
  }

  const actorEmails = [ownerEmail, managerEmail, actorAEmail, reviewerEmail, actorBEmail]

  if (new Set(actorEmails).size !== actorEmails.length) {
    throw new Error("Every RLS actor must use a different authentication user.")
  }

  if (actorAOrganizationId === actorBOrganizationId) {
    throw new Error("The two RLS actors must use different organizations.")
  }

  if (new Set(configuredIds).size !== configuredIds.length) {
    throw new Error("Organization, submission, and file fixture IDs must be distinct.")
  }

  return {
    supabaseUrl,
    publishableKey,
    owner: {
      label: "actor-a-owner",
      email: ownerEmail,
      password: environment.BIZFLOW_RLS_OWNER_PASSWORD,
      organizationId: actorAOrganizationId,
    },
    manager: {
      label: "actor-a-manager",
      email: managerEmail,
      password: environment.BIZFLOW_RLS_MANAGER_PASSWORD,
      organizationId: actorAOrganizationId,
    },
    actorA: {
      label: "actor-a-staff",
      email: actorAEmail,
      password: environment.BIZFLOW_RLS_ACTOR_A_PASSWORD,
      organizationId: actorAOrganizationId,
    },
    reviewer: {
      label: "actor-a-reviewer",
      email: reviewerEmail,
      password: environment.BIZFLOW_RLS_REVIEWER_PASSWORD,
      organizationId: actorAOrganizationId,
    },
    actorB: {
      label: "actor-b-internal",
      email: actorBEmail,
      password: environment.BIZFLOW_RLS_ACTOR_B_PASSWORD,
      organizationId: actorBOrganizationId,
    },
    fixtures: {
      staff: {
        label: "staff-created",
        organizationId: actorAOrganizationId,
        submissionId: staffSubmissionId,
        fileId: staffFileId,
      },
      manager: {
        label: "manager-created",
        organizationId: actorAOrganizationId,
        submissionId: managerSubmissionId,
        fileId: managerFileId,
      },
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
    throw new Error(`${actorLabel} ${assertion} exposed a fixture that must be hidden.`)
  }

  logPass(actorLabel, assertion, startedAt)
}

/**
 * Verify one actor's exact active organization role.
 *
 * @param {ReturnType<typeof createClient>} client - Authenticated Supabase client.
 * @param {{ label: string, organizationId: string }} actor - Synthetic actor metadata.
 * @param {string} userId - Authenticated actor identifier.
 * @param {string[]} expectedRoles - Exact roles allowed for this fixture actor.
 * @returns {Promise<void>}
 * @throws {Error} When the membership is hidden, duplicated, inactive, or has the wrong role.
 */
async function expectActorRole(client, actor, userId, expectedRoles) {
  const membership = await expectOneVisible(
    client,
    actor.label,
    "organization_memberships",
    "id,role",
    {
      org_id: actor.organizationId,
      user_id: userId,
      status: "active",
    },
    "own-active-membership-visible"
  )

  if (typeof membership.role !== "string" || !expectedRoles.includes(membership.role)) {
    throw new Error(`${actor.label} does not have its required synthetic fixture role.`)
  }
}

/**
 * Require an exact submission and its exact file to be visible and correctly related.
 *
 * @param {ReturnType<typeof createClient>} client - Authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @param {{ label: string, organizationId: string, submissionId: string, fileId: string }} fixture - Exact fixture IDs.
 * @param {string} expectedCreatorId - Authenticated creator ID for fixture-integrity checks.
 * @returns {Promise<void>}
 * @throws {Error} When either row is hidden, duplicated, or does not match the fixture contract.
 */
async function expectSubmissionFixtureVisible(
  client,
  actorLabel,
  fixture,
  expectedCreatorId
) {
  const submission = await expectOneVisible(
    client,
    actorLabel,
    "submissions",
    "id,org_id,created_by",
    {
      id: fixture.submissionId,
      org_id: fixture.organizationId,
    },
    `${fixture.label}-submission-visible`
  )

  if (submission.created_by !== expectedCreatorId) {
    throw new Error(`${fixture.label} submission does not have its configured synthetic creator.`)
  }

  const submissionFile = await expectOneVisible(
    client,
    actorLabel,
    "submission_files",
    "id,org_id,submission_id",
    {
      id: fixture.fileId,
      org_id: fixture.organizationId,
      submission_id: fixture.submissionId,
    },
    `${fixture.label}-file-visible`
  )

  if (
    submissionFile.org_id !== fixture.organizationId ||
    submissionFile.submission_id !== fixture.submissionId
  ) {
    throw new Error(`${fixture.label} file does not belong to its configured submission.`)
  }
}

/**
 * Require an exact submission and its exact file to be hidden.
 *
 * @param {ReturnType<typeof createClient>} client - Authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @param {{ label: string, organizationId: string, submissionId: string, fileId: string }} fixture - Exact fixture IDs.
 * @returns {Promise<void>}
 * @throws {Error} When either protected row is exposed.
 */
async function expectSubmissionFixtureHidden(client, actorLabel, fixture) {
  await expectHidden(
    client,
    actorLabel,
    "submissions",
    {
      id: fixture.submissionId,
      org_id: fixture.organizationId,
    },
    `${fixture.label}-submission-hidden`
  )
  await expectHidden(
    client,
    actorLabel,
    "submission_files",
    {
      id: fixture.fileId,
      org_id: fixture.organizationId,
      submission_id: fixture.submissionId,
    },
    `${fixture.label}-file-hidden`
  )
}

/**
 * Build null-only RPC arguments that reach validation only if EXECUTE was accidentally granted.
 *
 * @param {string} functionName - Submission mutation RPC name.
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
      target_actor_user_id: null,
    },
    save_internal_submission_draft: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null,
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
      target_actor_user_id: null,
    },
    complete_internal_submission_file: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_storage_key: null,
      target_content_type: null,
      target_byte_size: null,
      target_checksum_sha256: null,
      target_actor_user_id: null,
    },
    supersede_internal_submission_file: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_actor_user_id: null,
    },
    record_internal_submission_file_upload_window: {
      target_org_id: null,
      target_submission_id: null,
      target_file_id: null,
      target_cleanup_after: null,
      target_actor_user_id: null,
    },
    mark_internal_submission_file_storage_cleaned: {
      target_file_id: null,
      target_storage_key: null,
    },
    submit_internal_submission: {
      target_org_id: null,
      target_submission_id: null,
      target_expected_revision: null,
      target_values: null,
      target_actor_user_id: null,
    },
  }
  const rpcArguments = argumentsByFunction[functionName]

  if (!rpcArguments) {
    throw new Error(`Unknown authenticated RPC-denial assertion: ${functionName}.`)
  }

  return rpcArguments
}

/**
 * Verify every submission mutation and maintenance RPC remains unavailable to authenticated users.
 *
 * @param {ReturnType<typeof createClient>} client - Ordinary authenticated Supabase client.
 * @param {string} actorLabel - Non-sensitive actor label.
 * @returns {Promise<void>}
 * @throws {Error} When any RPC executes or returns a non-permission failure.
 */
async function expectAuthenticatedSubmissionRpcsDenied(client, actorLabel) {
  for (const functionName of AUTHENTICATED_SUBMISSION_RPC_NAMES) {
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
 * @param {"submissions" | "submission_files"} table - Submission table under test.
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
      template_snapshot: { schemaVersion: 1 },
      values: {},
      status: "draft",
      revision: 1,
      created_by: actorUserId,
      updated_by: actorUserId,
    }
  }

  const submissionId = randomUUID()
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
    uploaded_by: actorUserId,
  }
}

/**
 * Verify direct authenticated INSERT, UPDATE, and DELETE remain denied for submission data.
 *
 * @param {ReturnType<typeof createClient>} client - Ordinary authenticated Supabase client.
 * @param {{ label: string, organizationId: string }} actor - Manager fixture metadata.
 * @param {string} actorUserId - Authenticated actor identifier.
 * @returns {Promise<void>}
 * @throws {Error} When any direct mutation is not rejected with PostgreSQL code 42501.
 */
async function expectDirectSubmissionWritesDenied(client, actor, actorUserId) {
  for (const probe of DIRECT_SUBMISSION_WRITE_PLAN) {
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
        .update({ updated_at: new Date(0).toISOString() })
        .eq("id", randomUUID())
        .select("id")
    } else {
      result = await client.from(probe.table).delete().eq("id", randomUUID()).select("id")
    }

    const { data, error, status } = result

    if (!error || error.code !== "42501" || (Array.isArray(data) && data.length > 0)) {
      throw new Error(
        `${actor.label} direct-${probe.table}-${probe.operation} expected code=42501; observed status=${status ?? error?.status ?? "unknown"}, code=${error?.code ?? "none"}.`
      )
    }

    logPass(actor.label, `direct-${probe.table}-${probe.operation}-denied`, startedAt)
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
  const actorDefinitions = {
    owner: configuration.owner,
    manager: configuration.manager,
    staff: configuration.actorA,
    reviewer: configuration.reviewer,
    tenantB: configuration.actorB,
  }
  const clients = Object.fromEntries(
    Object.keys(actorDefinitions).map((actorKey) => [
      actorKey,
      createClient(configuration.supabaseUrl, configuration.publishableKey, clientOptions),
    ])
  )

  try {
    const authenticatedActorEntries = []

    // Authenticate sequentially so finally never races with unfinished sign-in requests.
    for (const [actorKey, actor] of Object.entries(actorDefinitions)) {
      authenticatedActorEntries.push([
        actorKey,
        await authenticateActor(clients[actorKey], actor),
      ])
    }

    const authenticatedActors = Object.fromEntries(authenticatedActorEntries)
    const authenticatedUserIds = Object.values(authenticatedActors).map((user) => user.id)

    if (new Set(authenticatedUserIds).size !== authenticatedUserIds.length) {
      throw new Error("Multiple credentials authenticated as the same user; distinct fixtures are required.")
    }

    await Promise.all([
      expectActorRole(
        clients.owner,
        configuration.owner,
        authenticatedActors.owner.id,
        ["owner_admin"]
      ),
      expectActorRole(
        clients.manager,
        configuration.manager,
        authenticatedActors.manager.id,
        ["manager"]
      ),
      expectActorRole(
        clients.staff,
        configuration.actorA,
        authenticatedActors.staff.id,
        ["staff"]
      ),
      expectActorRole(
        clients.reviewer,
        configuration.reviewer,
        authenticatedActors.reviewer.id,
        ["external_reviewer"]
      ),
      expectActorRole(
        clients.tenantB,
        configuration.actorB,
        authenticatedActors.tenantB.id,
        ["owner_admin", "manager", "staff"]
      ),
    ])

    await expectOneVisible(
      clients.staff,
      configuration.actorA.label,
      "organizations",
      "id",
      { id: configuration.actorA.organizationId },
      "own-organization-visible"
    )
    await expectHidden(
      clients.staff,
      configuration.actorA.label,
      "organizations",
      { id: configuration.actorB.organizationId },
      "other-organization-hidden"
    )
    await expectHidden(
      clients.staff,
      configuration.actorA.label,
      "organization_memberships",
      {
        org_id: configuration.actorB.organizationId,
        user_id: authenticatedActors.tenantB.id,
      },
      "other-membership-hidden"
    )
    await expectOneVisible(
      clients.tenantB,
      configuration.actorB.label,
      "organizations",
      "id",
      { id: configuration.actorB.organizationId },
      "own-organization-visible"
    )
    await expectHidden(
      clients.tenantB,
      configuration.actorB.label,
      "organizations",
      { id: configuration.actorA.organizationId },
      "other-organization-hidden"
    )
    await expectHidden(
      clients.tenantB,
      configuration.actorB.label,
      "organization_memberships",
      {
        org_id: configuration.actorA.organizationId,
        user_id: authenticatedActors.staff.id,
      },
      "other-membership-hidden"
    )

    const fixtures = {
      staff: {
        ...configuration.fixtures.staff,
        creatorId: authenticatedActors.staff.id,
      },
      manager: {
        ...configuration.fixtures.manager,
        creatorId: authenticatedActors.manager.id,
      },
    }

    for (const assertion of SUBMISSION_VISIBILITY_PLAN) {
      const actor = actorDefinitions[assertion.actor]
      const fixture = fixtures[assertion.fixture]

      if (assertion.visible) {
        await expectSubmissionFixtureVisible(
          clients[assertion.actor],
          actor.label,
          fixture,
          fixture.creatorId
        )
      } else {
        await expectSubmissionFixtureHidden(clients[assertion.actor], actor.label, fixture)
      }
    }

    await expectAuthenticatedSubmissionRpcsDenied(
      clients.manager,
      configuration.manager.label
    )
    await expectDirectSubmissionWritesDenied(
      clients.manager,
      configuration.manager,
      authenticatedActors.manager.id
    )
    await expectStaffDirectWriteDenied(clients.staff, configuration.actorA)

    const durationMs = Math.round(performance.now() - startedAt)
    console.log(`[check=authenticated-two-tenant-rls] pass duration_ms=${durationMs}`)
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
