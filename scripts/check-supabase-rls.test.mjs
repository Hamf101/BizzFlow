import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  AUTHENTICATED_POLICY_HELPER_RPC_NAMES,
  AUTHENTICATED_SUBMISSION_RPC_NAMES,
  AUTHENTICATED_UPLOAD_BARRIER_RPC_NAMES,
  buildConfiguration,
  DIRECT_ACCESS_CLOSED_TABLES,
  DIRECT_PUBLIC_LINK_WRITE_PLAN,
  DIRECT_SUBMISSION_WRITE_PLAN,
  HELP_TEXT,
  mergeEnvironment,
} from "./check-supabase-rls.mjs"
import {
  RESOURCE_PURGE_SCHEMA_CONTRACT,
  SERVICE_ROLE_READ_ONLY_RPC_CHECKS,
  SERVICE_ROLE_RPC_CHECKS,
  TABLE_CHECKS,
} from "./check-supabase-live.mjs"

const CLOSE_DIRECT_ACCESS_MIGRATION =
  "supabase/migrations/20260912194858_close_direct_tenant_table_access.sql"

const VALID_ENVIRONMENT = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
  BIZFLOW_RLS_TEST_CONFIRM: "synthetic-test-fixtures",
  BIZFLOW_RLS_OWNER_EMAIL: "owner@example.invalid",
  BIZFLOW_RLS_OWNER_PASSWORD: "owner-password",
  BIZFLOW_RLS_MANAGER_EMAIL: "manager@example.invalid",
  BIZFLOW_RLS_MANAGER_PASSWORD: "manager-password",
  BIZFLOW_RLS_ACTOR_A_EMAIL: "actor-a@example.invalid",
  BIZFLOW_RLS_ACTOR_A_PASSWORD: "actor-a-password",
  BIZFLOW_RLS_ACTOR_A_ORG_ID: "11111111-1111-4111-8111-111111111111",
  BIZFLOW_RLS_REVIEWER_EMAIL: "reviewer@example.invalid",
  BIZFLOW_RLS_REVIEWER_PASSWORD: "reviewer-password",
  BIZFLOW_RLS_ACTOR_B_EMAIL: "actor-b@example.invalid",
  BIZFLOW_RLS_ACTOR_B_PASSWORD: "actor-b-password",
  BIZFLOW_RLS_ACTOR_B_ORG_ID: "22222222-2222-4222-8222-222222222222",
}

describe("authenticated Supabase direct-access harness configuration", () => {
  it("fails closed when the explicit synthetic-fixture opt-in is incorrect", () => {
    expect(() =>
      buildConfiguration({
        ...VALID_ENVIRONMENT,
        BIZFLOW_RLS_TEST_CONFIRM: "production-data",
      })
    ).toThrow("opt-in")
  })

  it("rejects secret keys before any live authentication or query", () => {
    expect(() =>
      buildConfiguration({
        ...VALID_ENVIRONMENT,
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_must-not-be-used",
      })
    ).toThrow("sb_publishable_")
  })

  it("requires distinct synthetic organizations", () => {
    expect(() =>
      buildConfiguration({
        ...VALID_ENVIRONMENT,
        BIZFLOW_RLS_ACTOR_B_ORG_ID: VALID_ENVIRONMENT.BIZFLOW_RLS_ACTOR_A_ORG_ID,
      })
    ).toThrow("different organizations")
  })

  it("requires distinct synthetic actor credentials", () => {
    expect(() =>
      buildConfiguration({
        ...VALID_ENVIRONMENT,
        BIZFLOW_RLS_REVIEWER_EMAIL: VALID_ENVIRONMENT.BIZFLOW_RLS_MANAGER_EMAIL,
      })
    ).toThrow("different authentication user")
  })

  it("builds the same-organization actor contract without row fixtures", () => {
    const configuration = buildConfiguration(VALID_ENVIRONMENT)

    expect(configuration.owner.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.manager.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.reviewer.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.actorB.organizationId).not.toBe(
      configuration.actorA.organizationId
    )
    expect(configuration).not.toHaveProperty("fixtures")
  })

  it("keeps process environment values authoritative over the local file", () => {
    expect(
      mergeEnvironment(
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" },
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "file@example.invalid" }
      )
    ).toEqual({ BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" })
  })

  it("documents the no-service-role, non-persisting, denial-only contract", () => {
    expect(HELP_TEXT).toContain("never a secret/service-role key")
    expect(HELP_TEXT).toContain("No fixture rows are created, updated, or deleted")
    expect(HELP_TEXT).toContain("fresh nonexistent foreign keys")
    expect(HELP_TEXT).toContain("denied direct reads of every tenant table")
    expect(HELP_TEXT).not.toContain("SUBMISSION_ID")
  })

  it("closes direct reads on exactly the tables the migrations revoke", () => {
    const revokedTables = [
      CLOSE_DIRECT_ACCESS_MIGRATION,
      "supabase/migrations/20260914215806_saved_list_views.sql",
    ].flatMap(
      (path) =>
        readFileSync(path, "utf8")
          .replace(/\s+/g, " ")
          .toLowerCase()
          .match(/revoke all privileges on table (.+?) from anon, authenticated;/)?.[1]
          .split(",")
          .map((table) => table.trim().replace(/^public\./, "")) ?? []
    )

    expect(revokedTables.length).toBeGreaterThan(20)
    expect([...DIRECT_ACCESS_CLOSED_TABLES].sort()).toEqual([...revokedTables].sort())
  })

  it("covers all service-only RPCs, row-security helpers, and direct table mutations", () => {
    expect(AUTHENTICATED_SUBMISSION_RPC_NAMES).toEqual([
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
      "create_internal_submission_comment",
    ])
    expect(AUTHENTICATED_UPLOAD_BARRIER_RPC_NAMES).toEqual([
      "register_document_version_upload_authorization",
      "reconcile_document_upload_authorization_barriers",
    ])
    expect(AUTHENTICATED_POLICY_HELPER_RPC_NAMES).toEqual([
      "is_organization_member",
      "organization_role_for",
      "shares_organization_with_profile",
    ])
    expect(DIRECT_SUBMISSION_WRITE_PLAN).toEqual([
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
      { table: "submission_activity_events", operation: "delete" },
    ])
    expect(DIRECT_PUBLIC_LINK_WRITE_PLAN).toEqual([
      { table: "public_form_links", operation: "insert" },
      { table: "public_form_links", operation: "update" },
      { table: "public_form_links", operation: "delete" },
    ])
  })

  it("keeps live schema and service-role checks aligned with the authenticated boundary", () => {
    expect(TABLE_CHECKS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "public_form_links" }),
        expect.objectContaining({ name: "submissions" }),
        expect.objectContaining({ name: "submission_files" }),
        expect.objectContaining({ name: "submission_comments" }),
        expect.objectContaining({ name: "submission_activity_events" }),
      ])
    )
    expect(SERVICE_ROLE_RPC_CHECKS.map((rpc) => rpc.name)).toEqual([
      ...AUTHENTICATED_SUBMISSION_RPC_NAMES,
      ...AUTHENTICATED_UPLOAD_BARRIER_RPC_NAMES,
      // Audit-chain verification is service-role-only and probed the same
      // way (null args reach the function's 22023 validation guard).
      "verify_audit_log_chain",
      // So is the atomic public submission, which refuses null details
      // before it locks or writes anything.
      "submit_public_form_entry",
      // And the abandoned-upload expiry, which refuses a missing batch size
      // before it selects anything.
      "expire_abandoned_submission_files",
    ])
    expect(SERVICE_ROLE_RPC_CHECKS.every((rpc) =>
      Object.values(rpc.args).every((value) => value === null)
    )).toBe(true)
    expect(
      TABLE_CHECKS.find((table) => table.name === "document_versions")?.select
    ).toContain("upload_authorization_expires_at")
    expect(
      TABLE_CHECKS.find((table) => table.name === "submissions")?.select
    ).toContain("assigned_to")
    expect(
      TABLE_CHECKS.find((table) => table.name === "submission_activity_events")
        ?.select
    ).toContain("submission_revision")
    expect(
      RESOURCE_PURGE_SCHEMA_CONTRACT.tableNames.every((tableName) =>
        TABLE_CHECKS.some((table) => table.name === tableName)
      )
    ).toBe(true)
    expect(RESOURCE_PURGE_SCHEMA_CONTRACT.functionNames).toEqual([
      "request_document_purge",
      "request_folder_purge",
      "enqueue_due_resource_purges",
      "lease_resource_purge_objects",
      "complete_resource_purge_object",
      "fail_resource_purge_object",
      "finalize_ready_resource_purges",
    ])
    expect(
      SERVICE_ROLE_RPC_CHECKS.some((rpc) =>
        RESOURCE_PURGE_SCHEMA_CONTRACT.functionNames.includes(rpc.name)
      )
    ).toBe(false)
    expect(SERVICE_ROLE_READ_ONLY_RPC_CHECKS.map((rpc) => rpc.name)).toEqual([
      "validate_internal_submission_values",
      "increment_public_form_link_submission_count",
      "get_folder_access_levels",
      "get_document_access_levels",
    ])
    // The access probes ask about no ids, so they never read a tenant's rows.
    expect(SERVICE_ROLE_READ_ONLY_RPC_CHECKS.slice(2).map((rpc) => rpc.args)).toEqual([
      { target_org_id: null, target_folder_ids: [], target_actor_user_id: null },
      { target_org_id: null, target_document_ids: [], target_actor_user_id: null },
    ])
    expect(
      SERVICE_ROLE_READ_ONLY_RPC_CHECKS[0].args.target_values.signature.length
    ).toBeGreaterThan(20_000)
    expect(
      SERVICE_ROLE_READ_ONLY_RPC_CHECKS[0].args.target_template_snapshot
    ).toEqual({
      schemaVersion: "3",
      blocks: [
        {
          id: "signature-block",
          fieldKey: "signature",
          type: "signature_field",
        },
      ],
    })
    expect(SERVICE_ROLE_READ_ONLY_RPC_CHECKS[1].args).toEqual({ p_token: null })
  })
})
