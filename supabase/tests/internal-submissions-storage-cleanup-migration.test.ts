import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260718184631_sprint_7_submission_storage_cleanup.sql"
)
const sql = normalizeFunctionSignatures(
  normalizeSql(readFileSync(migrationPath, "utf8"))
)

const serviceRoleFunctions = [
  "public.record_internal_submission_file_upload_window(uuid, uuid, uuid, timestamptz, uuid)",
  "public.mark_internal_submission_file_storage_cleaned(uuid, text)",
] as const

function normalizeFunctionSignatures(migrationSql: string): string {
  return migrationSql.replace(
    /function ([a-z0-9_.]+)\s*\(\s*([^)]*?)\s*\)/g,
    (_match: string, functionName: string, parameters: string): string =>
      `function ${functionName}(${parameters.replace(/\s*,\s*/g, ", ").trim()})`
  )
}

function hasServiceRoleOnlyExecution(
  migrationSql: string,
  functionSignature: string
): boolean {
  return (
    (migrationSql.includes(
      `revoke all on function ${functionSignature} from public, anon, authenticated`
    ) ||
      migrationSql.includes(
        `revoke all on function ${functionSignature} from public, anon, authenticated, service_role`
      )) &&
    migrationSql.includes(
      `grant execute on function ${functionSignature} to service_role`
    ) &&
    !migrationSql.includes(
      `grant execute on function ${functionSignature} to public`
    ) &&
    !migrationSql.includes(
      `grant execute on function ${functionSignature} to anon`
    ) &&
    !migrationSql.includes(
      `grant execute on function ${functionSignature} to authenticated`
    )
  )
}

describe("Sprint 7 submission storage cleanup migration", () => {
  it("persists a bounded cleanup deadline and completion marker", () => {
    expect(sql).toContain("add column cleanup_after timestamptz not null")
    expect(sql).toContain("default (now() + interval '20 minutes')")
    expect(sql).toContain("add column storage_cleaned_at timestamptz")
    expect(sql).toContain("submission_files_storage_cleanup_check")
    expect(sql).toContain("submission_files_cleanup_due_idx")
    expect(sql).toContain("where status = 'superseded' and storage_cleaned_at is null")
  })

  it("allows only monotonic pending-window renewal and one cleanup mark", () => {
    expect(sql).toContain("new.cleanup_after < old.cleanup_after")
    expect(sql).toContain("new.cleanup_after > old.cleanup_after")
    expect(sql).toContain(
      "old.storage_cleaned_at is null and new.storage_cleaned_at is not null"
    )
    expect(sql).toContain("new.cleanup_after is distinct from old.cleanup_after")
    expect(sql).toContain("new.storage_cleaned_at is not null")
  })

  it("keeps upload-window renewal service-only and tightly bounded", () => {
    expect(sql).toContain(
      "create or replace function public.record_internal_submission_file_upload_window"
    )
    expect(sql).toContain("security invoker set search_path = ''")
    expect(sql).toContain(
      "target_cleanup_after > now() + interval '25 minutes'"
    )
    expect(hasServiceRoleOnlyExecution(sql, serviceRoleFunctions[0])).toBe(true)
  })

  it("marks storage cleaned only after expiry and only for superseded rows", () => {
    expect(sql).toContain(
      "create or replace function public.mark_internal_submission_file_storage_cleaned"
    )
    expect(sql).toContain("locked_file.status <> 'superseded'")
    expect(sql).toContain("locked_file.cleanup_after > now()")
    expect(sql).toContain("set storage_cleaned_at = now(), updated_at = now()")
    expect(hasServiceRoleOnlyExecution(sql, serviceRoleFunctions[1])).toBe(true)
  })

  it("fails the service-only contract when a grant is mutated to authenticated", () => {
    for (const functionSignature of serviceRoleFunctions) {
      const unsafeSql = sql.replace(
        `grant execute on function ${functionSignature} to service_role`,
        `grant execute on function ${functionSignature} to authenticated`
      )

      expect(unsafeSql).not.toBe(sql)
      expect(hasServiceRoleOnlyExecution(unsafeSql, functionSignature)).toBe(
        false
      )
    }
  })
})
