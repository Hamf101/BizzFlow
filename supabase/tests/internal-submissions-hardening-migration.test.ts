import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260718175458_sprint_7_submission_function_hardening.sql"
)

describe("Sprint 7 submission function hardening migration", () => {
  it("replaces the shadowed template record with an assigned row type", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(sql).toContain(
      "create or replace function public.create_internal_submission_draft("
    )
    expect(sql).toContain(
      "locked_template public.document_templates%rowtype"
    )
    expect(sql).toContain("select template_row.* into locked_template")
    expect(sql).toContain("from public.document_templates template_row")
    expect(sql).toContain("locked_template.revision")
    expect(sql).toContain("locked_template.content")
    expect(sql).not.toContain("declare template record")
  })

  it("preserves service-only execution and reloads the schema cache", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(sql).toMatch(
      /revoke all on function public\.create_internal_submission_draft\([^;]+\) from public, anon, authenticated/
    )
    expect(sql).toMatch(
      /grant execute on function public\.create_internal_submission_draft\([^;]+\) to service_role/
    )
    expect(sql).not.toContain("security definer")
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
