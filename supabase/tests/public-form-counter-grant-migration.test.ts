import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { normalizeSql } from "./migration-contract-helpers"

const migrationSql = normalizeSql(
  readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260826225631_restrict_public_form_counter_to_service_role.sql"
    ),
    "utf8"
  )
)

const functionSignature =
  "function public.increment_public_form_link_submission_count(text)"

describe("public-form counter grant migration contract", () => {
  it("leaves the counter RPC executable only by service_role", () => {
    const revokeStatement =
      `revoke execute on ${functionSignature} ` +
      "from public, anon, authenticated, service_role"
    const grantStatement =
      `grant execute on ${functionSignature} to service_role`

    expect(migrationSql).toContain(revokeStatement)
    expect(migrationSql).toContain(grantStatement)
    expect(migrationSql.indexOf(grantStatement)).toBeGreaterThan(
      migrationSql.indexOf(revokeStatement)
    )
    expect(migrationSql).not.toContain(
      `grant execute on ${functionSignature} to public`
    )
    expect(migrationSql).not.toContain(
      `grant execute on ${functionSignature} to anon`
    )
    expect(migrationSql).not.toContain(
      `grant execute on ${functionSignature} to authenticated`
    )
  })

  it("reloads the PostgREST schema cache after the privilege change", () => {
    expect(migrationSql).toContain("notify pgrst, 'reload schema'")
  })
})
