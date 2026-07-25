import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260725190000_organization_context_function.sql"),
  "utf8"
)
const normalizedSql = normalizeSql(migrationSql)

describe("organization context function migration", () => {
  it("creates a hardened read-only context function", () => {
    expect(normalizedSql).toContain(
      "create or replace function public.get_current_organization_context( target_user_id uuid )"
    )
    expect(normalizedSql).toContain("stable")
    expect(normalizedSql).toContain("security invoker")
    expect(normalizedSql).toContain("set search_path = ''")
  })

  it("preserves the oldest-active-membership selection contract", () => {
    expect(normalizedSql).toContain("membership.status = 'active'")
    expect(normalizedSql).toContain("order by membership.created_at asc")
    expect(normalizedSql).toContain("limit 1")
    expect(normalizedSql).toContain(
      "join public.organizations organization on organization.id = membership.org_id"
    )
  })

  it("locks execution down to the service role", () => {
    expect(normalizedSql).toContain(
      "revoke all on function public.get_current_organization_context(uuid) from public, anon, authenticated"
    )
    expect(normalizedSql).toContain(
      "grant execute on function public.get_current_organization_context(uuid) to service_role"
    )
    expect(normalizedSql).toContain("notify pgrst, 'reload schema'")
  })
})
