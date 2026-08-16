import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { getMigrationPath, normalizeSql } from "./migration-contract-helpers"

const migrationSql = readFileSync(
  getMigrationPath("20260731090000_sprint_9_automatic_due_reminders.sql"),
  "utf8"
)

const normalized = normalizeSql(migrationSql)

describe("sprint 9 automatic due reminder migration contract", () => {
  it("adds the origin column that separates automatic from manual reminders", () => {
    expect(normalized).toContain(
      "add column if not exists origin text not null default 'manual'"
    )
    expect(normalized).toContain(
      "check (origin in ('manual', 'automatic'))"
    )
  })

  it("widens the channel check to the channels the domain already declares", () => {
    // TASK_REMINDER_CHANNELS and the task detail form both offer sms, but the
    // original check only allowed email, so choosing sms failed at write time.
    expect(normalized).toContain(
      "check (channel in ('email', 'sms'))"
    )
  })

  it("indexes the lookup the automatic reminder sync performs", () => {
    expect(normalized).toContain(
      "create index if not exists task_reminders_task_automatic_pending_idx"
    )
    expect(normalized).toContain("where origin = 'automatic' and status = 'pending'")
  })

  it("is re-runnable", () => {
    // Every statement guards against an existing object so a partially applied
    // migration can be replayed without manual repair.
    expect(normalized).toContain("add column if not exists")
    expect(normalized).toContain("drop constraint if exists")
    expect(normalized).toContain("create index if not exists")
  })
})
