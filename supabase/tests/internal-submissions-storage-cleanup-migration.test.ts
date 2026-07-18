import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  getMigrationPath,
  normalizeSql,
} from "./migration-contract-helpers"

const migrationPath = getMigrationPath(
  "20260718184631_sprint_7_submission_storage_cleanup.sql"
)
const sql = normalizeSql(readFileSync(migrationPath, "utf8"))

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
    expect(sql).toContain(
      "revoke all on function public.record_internal_submission_file_upload_window"
    )
    expect(sql).toContain(
      "grant execute on function public.record_internal_submission_file_upload_window"
    )
  })

  it("marks storage cleaned only after expiry and only for superseded rows", () => {
    expect(sql).toContain(
      "create or replace function public.mark_internal_submission_file_storage_cleaned"
    )
    expect(sql).toContain("locked_file.status <> 'superseded'")
    expect(sql).toContain("locked_file.cleanup_after > now()")
    expect(sql).toContain("set storage_cleaned_at = now(), updated_at = now()")
    expect(sql).toContain(
      "revoke all on function public.mark_internal_submission_file_storage_cleaned"
    )
    expect(sql).toContain(
      "grant execute on function public.mark_internal_submission_file_storage_cleaned"
    )
  })
})
