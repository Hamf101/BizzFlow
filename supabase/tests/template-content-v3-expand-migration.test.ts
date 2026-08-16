import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260729121109_template_content_v3_expand.sql"
)

describe("template content v3 expand migration", () => {
  it("expands all persisted template constraints to strict v2 or v3 roots", () => {
    const migrationSql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(migrationSql).toContain(
      "add constraint document_templates_content_object check"
    )
    expect(migrationSql).toContain(
      "add constraint documents_generated_snapshot_check check"
    )
    expect(migrationSql).toContain(
      "add constraint submissions_template_snapshot_object check"
    )
    expect(migrationSql.match(/->> 'schemaversion' = '2'/g)).toHaveLength(3)
    expect(migrationSql.match(/->> 'schemaversion' = '3'/g)).toHaveLength(3)
    expect(migrationSql).toContain(
      "content - array['schemaversion', 'branding', 'blocks']::text[] = '{}'::jsonb"
    )
    expect(migrationSql).toContain(
      "and jsonb_typeof(content -> 'layout') = 'object'"
    )
    expect(migrationSql).toContain(
      "and jsonb_typeof(content -> 'sections') = 'array'"
    )
    expect(migrationSql).toContain(
      "and jsonb_typeof(content -> 'fieldgroups') = 'array'"
    )
    expect(migrationSql).toContain(
      "and jsonb_typeof(content -> 'blockrules') = 'array'"
    )
  })

  it("does not rewrite snapshots, disable guards, or replace active RPCs", () => {
    const migrationSql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(migrationSql).not.toMatch(/\bupdate public\./)
    expect(migrationSql).not.toContain("disable trigger")
    expect(migrationSql).not.toContain("create or replace function")
    expect(migrationSql).not.toContain("set template_snapshot")
  })
})
