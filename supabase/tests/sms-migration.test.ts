import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationPath = getMigrationPath("20260730110000_sprint_10_sms.sql")
const migrationSql = readFileSync(migrationPath, "utf8")
const normalizedSql = normalizeSql(migrationSql)

describe("Sprint 10 SMS migration", () => {
  it("adds phone_number to public.profiles with E.164 format validation", () => {
    expect(normalizedSql).toContain(
      "alter table public.profiles add column if not exists phone_number text"
    )
    expect(normalizedSql).toContain("profiles_phone_number_format")
    expect(normalizedSql).toContain("phone_number ~ '^\\+[1-9]\\d{1,14}$'")
  })

  it("updates task_reminders channel check constraint to allow sms", () => {
    expect(normalizedSql).toContain("task_reminders_channel_check")
    expect(normalizedSql).toContain("check (channel in ('email', 'sms'))")
    expect(normalizedSql).toContain("notify pgrst, 'reload schema'")
  })
})
