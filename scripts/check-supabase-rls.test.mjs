import { describe, expect, it } from "vitest"

import { buildConfiguration, HELP_TEXT, mergeEnvironment } from "./check-supabase-rls.mjs"

const VALID_ENVIRONMENT = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-value",
  BIZFLOW_RLS_TEST_CONFIRM: "synthetic-test-fixtures",
  BIZFLOW_RLS_ACTOR_A_EMAIL: "actor-a@example.invalid",
  BIZFLOW_RLS_ACTOR_A_PASSWORD: "actor-a-password",
  BIZFLOW_RLS_ACTOR_A_ORG_ID: "11111111-1111-4111-8111-111111111111",
  BIZFLOW_RLS_ACTOR_B_EMAIL: "actor-b@example.invalid",
  BIZFLOW_RLS_ACTOR_B_PASSWORD: "actor-b-password",
  BIZFLOW_RLS_ACTOR_B_ORG_ID: "22222222-2222-4222-8222-222222222222",
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

  it("keeps process environment values authoritative over the local file", () => {
    expect(
      mergeEnvironment(
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" },
        { BIZFLOW_RLS_ACTOR_A_EMAIL: "file@example.invalid" }
      )
    ).toEqual({ BIZFLOW_RLS_ACTOR_A_EMAIL: "process@example.invalid" })
  })

  it("documents the no-service-role and non-persisting fixture contract", () => {
    expect(HELP_TEXT).toContain("never a secret/service-role key")
    expect(HELP_TEXT).toContain("No fixture rows are created, updated, or deleted")
    expect(HELP_TEXT).toContain("not a manager-versus-staff policy")
  })
})
