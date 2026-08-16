import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260723181119_freeform_template_content_v2.sql"
)

describe("Free-form template content migration", () => {
  it("moves persisted content to schema version two without legacy regions", () => {
    const migrationSql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(migrationSql).toContain(
      "update public.document_templates set content = jsonb_build_object"
    )
    expect(migrationSql).toContain(
      "update public.documents set template_snapshot = jsonb_build_object"
    )
    expect(migrationSql).toContain(
      "update public.submissions set template_snapshot = jsonb_build_object"
    )
    expect(migrationSql).toContain("content ->> 'schemaversion' = '2'")
    expect(migrationSql).toContain(
      "jsonb_typeof(content -> 'blocks') = 'array'"
    )
    expect(migrationSql).toContain("and not content ? 'sections'")
    expect(migrationSql).toContain("and not content ? 'repeat'")
    expect(migrationSql).toContain(
      "disable trigger document_templates_enforce_revision"
    )
    expect(migrationSql).toContain(
      "enable trigger document_templates_enforce_revision"
    )
    expect(migrationSql).toContain(
      "disable trigger documents_prevent_snapshot_mutation"
    )
    expect(migrationSql).toContain(
      "enable trigger documents_prevent_snapshot_mutation"
    )
    expect(migrationSql).toContain("disable trigger submissions_enforce_update")
    expect(migrationSql).toContain("enable trigger submissions_enforce_update")
  })

  it("validates signing, submission, and file fields from one block flow", () => {
    const migrationSql = normalizeSql(readFileSync(migrationPath, "utf8"))
    const functionSection = migrationSql.slice(
      migrationSql.indexOf(
        "create or replace function public.complete_document_recipient_signature"
      )
    )

    expect(functionSection).toContain(
      "coalesce(document_snapshot -> 'blocks', '[]'::jsonb)"
    )
    expect(functionSection).toContain(
      "coalesce(target_template_snapshot -> 'blocks', '[]'::jsonb)"
    )
    expect(functionSection).toContain(
      "coalesce(locked_submission.template_snapshot -> 'blocks', '[]'::jsonb)"
    )
    expect(functionSection).not.toContain("#> '{sections")
  })
})
