import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260718181552_sprint_7_submission_upload_hardening.sql"
)

describe("Sprint 7 submission upload-hardening migration", () => {
  it("binds active allocations to expected checksums and recoverable tombstones", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    expect(sql).toContain("add column expected_checksum_sha256 text")
    expect(sql).toContain("add column superseded_by uuid")
    expect(sql).toContain("add column superseded_at timestamptz")
    expect(sql).toContain(
      "check (status in ('upload_pending', 'available', 'superseded'))"
    )
    expect(sql).toContain(
      "create unique index submission_files_active_field_idx on public.submission_files (submission_id, field_key) where status in ('upload_pending', 'available')"
    )
    expect(sql).toContain(
      "target_expected_checksum_sha256 !~ '^[0-9a-f]{64}$'"
    )
    expect(sql).toContain(
      "expected_checksum_sha256 = target_expected_checksum_sha256"
    )
  })

  it("serializes completion and superseding with the same lock order", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    for (const functionName of [
      "complete_internal_submission_file",
      "supersede_internal_submission_file",
    ]) {
      const start = sql.indexOf(
        `create or replace function public.${functionName}(`
      )
      const section = sql.slice(start)
      const submissionLock = section.indexOf(
        "from public.submissions submission"
      )
      const fileLock = section.indexOf(
        "from public.submission_files submission_file"
      )

      expect(start).toBeGreaterThan(-1)
      expect(submissionLock).toBeGreaterThan(-1)
      expect(fileLock).toBeGreaterThan(submissionLock)
      expect(section.slice(submissionLock, fileLock)).toContain("for update")
      expect(section.slice(fileLock)).toContain("for update")
    }

    expect(sql).toContain("set status = 'superseded'")
    expect(sql).toContain("if locked_file.status = 'superseded' then return locked_file")
    expect(sql).toContain("locked_file.status <> 'upload_pending'")
  })

  it("keeps all state-changing functions unavailable to browser roles", () => {
    const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

    for (const functionName of [
      "allocate_internal_submission_file",
      "complete_internal_submission_file",
      "supersede_internal_submission_file",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${functionName}\\([^;]+\\) from public, anon, authenticated`
        )
      )
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${functionName}\\([^;]+\\) to service_role`
        )
      )
    }

    expect(sql).not.toContain("security definer")
  })
})
