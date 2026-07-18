import { describe, expect, it } from "vitest"

import {
  AUTHENTICATED_SUBMISSION_RPC_NAMES,
  buildConfiguration,
  DIRECT_SUBMISSION_WRITE_PLAN,
  HELP_TEXT,
  mergeEnvironment,
  SUBMISSION_VISIBILITY_PLAN,
} from "./check-supabase-rls.mjs"
import {
  SERVICE_ROLE_READ_ONLY_RPC_CHECKS,
  SERVICE_ROLE_RPC_CHECKS,
  TABLE_CHECKS,
} from "./check-supabase-live.mjs"

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
  BIZFLOW_RLS_STAFF_SUBMISSION_ID: "33333333-3333-4333-8333-333333333333",
  BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID: "44444444-4444-4444-8444-444444444444",
  BIZFLOW_RLS_MANAGER_SUBMISSION_ID: "55555555-5555-4555-8555-555555555555",
  BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID: "66666666-6666-4666-8666-666666666666",
}

describe("authenticated Supabase RLS harness configuration", () => {
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

  it("requires distinct exact fixture identifiers", () => {
    expect(() =>
      buildConfiguration({
        ...VALID_ENVIRONMENT,
        BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID:
          VALID_ENVIRONMENT.BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID,
      })
    ).toThrow("fixture IDs must be distinct")
  })

  it("builds the exact same-organization actor and row fixture contract", () => {
    const configuration = buildConfiguration(VALID_ENVIRONMENT)

    expect(configuration.owner.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.manager.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.reviewer.organizationId).toBe(configuration.actorA.organizationId)
    expect(configuration.fixtures).toEqual({
      staff: {
        label: "staff-created",
        organizationId: VALID_ENVIRONMENT.BIZFLOW_RLS_ACTOR_A_ORG_ID,
        submissionId: VALID_ENVIRONMENT.BIZFLOW_RLS_STAFF_SUBMISSION_ID,
        fileId: VALID_ENVIRONMENT.BIZFLOW_RLS_STAFF_SUBMISSION_FILE_ID,
      },
      manager: {
        label: "manager-created",
        organizationId: VALID_ENVIRONMENT.BIZFLOW_RLS_ACTOR_A_ORG_ID,
        submissionId: VALID_ENVIRONMENT.BIZFLOW_RLS_MANAGER_SUBMISSION_ID,
        fileId: VALID_ENVIRONMENT.BIZFLOW_RLS_MANAGER_SUBMISSION_FILE_ID,
      },
    })
  })

  it("keeps process environment values authoritative over the local file", () => {
    expect(
      mergeEnvironment(
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" },
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "file@example.invalid" }
      )
    ).toEqual({ BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" })
  })

  it("documents the no-service-role and exact non-persisting fixture contract", () => {
    expect(HELP_TEXT).toContain("never a secret/service-role key")
    expect(HELP_TEXT).toContain("No fixture rows are created, updated, or deleted")
    expect(HELP_TEXT).toContain("fresh nonexistent foreign keys")
    expect(HELP_TEXT).toContain("exact configured IDs")
    expect(HELP_TEXT).toContain("assigned to the configured external reviewer")
    expect(HELP_TEXT).toContain("at least one comment and one activity event")
  })

  it("covers the complete submission and file visibility matrix", () => {
    expect(SUBMISSION_VISIBILITY_PLAN).toEqual([
      { actor: "owner", fixture: "staff", visible: true },
      { actor: "owner", fixture: "manager", visible: true },
      { actor: "manager", fixture: "staff", visible: true },
      { actor: "manager", fixture: "manager", visible: true },
      { actor: "staff", fixture: "staff", visible: true },
      { actor: "staff", fixture: "manager", visible: false },
      { actor: "reviewer", fixture: "staff", visible: true },
      { actor: "reviewer", fixture: "manager", visible: false },
      { actor: "tenantB", fixture: "staff", visible: false },
      { actor: "tenantB", fixture: "manager", visible: false },
    ])
  })

  it("covers all service-only RPCs and direct table mutations", () => {
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
  })

  it("keeps live schema and service-role checks aligned with the authenticated boundary", () => {
    expect(TABLE_CHECKS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "submissions" }),
        expect.objectContaining({ name: "submission_files" }),
        expect.objectContaining({ name: "submission_comments" }),
        expect.objectContaining({ name: "submission_activity_events" }),
      ])
    )
    expect(SERVICE_ROLE_RPC_CHECKS.map((rpc) => rpc.name)).toEqual(
      AUTHENTICATED_SUBMISSION_RPC_NAMES
    )
    expect(SERVICE_ROLE_RPC_CHECKS.every((rpc) =>
      Object.values(rpc.args).every((value) => value === null)
    )).toBe(true)
    expect(
      TABLE_CHECKS.find((table) => table.name === "submissions")?.select
    ).toContain("assigned_to")
    expect(
      TABLE_CHECKS.find((table) => table.name === "submission_activity_events")
        ?.select
    ).toContain("submission_revision")
    expect(SERVICE_ROLE_READ_ONLY_RPC_CHECKS).toHaveLength(1)
    expect(SERVICE_ROLE_READ_ONLY_RPC_CHECKS[0].name).toBe(
      "validate_internal_submission_values"
    )
    expect(
      SERVICE_ROLE_READ_ONLY_RPC_CHECKS[0].args.target_values.signature.length
    ).toBeGreaterThan(20_000)
  })
})
