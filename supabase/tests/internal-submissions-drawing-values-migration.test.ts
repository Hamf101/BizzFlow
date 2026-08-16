import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260718180607_sprint_7_submission_drawing_values.sql"
)

describe("Sprint 7 submission drawing-values migration", () => {
  it("keeps text limits while accepting validated drawing data URLs", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(sql).toContain(
      "create or replace function public.validate_internal_submission_values("
    )
    expect(sql).toContain(
      "matching_block ->> 'type' in ('signature_field', 'initials_field')"
    )
    expect(sql).toContain("char_length(answer_text) > 2800000")
    expect(sql).toContain(
      "answer_text !~ '^data:image/(png|jpeg);base64,[a-za-z0-9+/]+={0,2}$'"
    )
    expect(sql).toContain("char_length(answer_text) > 20000")
  })

  it("preserves service-only execution with an empty search path", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(sql).toContain("security invoker set search_path = ''")
    expect(sql).toMatch(
      /revoke all on function public\.validate_internal_submission_values\(jsonb, jsonb\) from public, anon, authenticated/
    )
    expect(sql).toMatch(
      /grant execute on function public\.validate_internal_submission_values\(jsonb, jsonb\) to service_role/
    )
    expect(sql).not.toContain("security definer")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
